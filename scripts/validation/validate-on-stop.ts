#!/usr/bin/env bun

import type { Scope } from "./detect-scope";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CODE_PATTERN, classifyScopes, expandConfigScope, getChangedFiles } from "./detect-scope";
import { resolveProjectRoot } from "./resolve-bin";
import { requiresGeneratedDependencyCheck } from "./routing-policy.ts";
import { LIVE_STOP_VALIDATION_POLICY } from "./validation-plan.ts";

export const UNCLASSIFIED_STOP_STEP_PREFIX = "STOP_UNCLASSIFIED_STEP";
export const STOP_VALIDATION_PROTOCOL = "kitsmith.stop-validation";
export const STOP_VALIDATION_PROTOCOL_VERSION = 1;
const OUTPUT_TAIL_LINES = 40;

type StopHookInput = {
  readonly stop_hook_active?: boolean;
};

type StopValidationFailureKind = "validation_failed" | "unclassified_stop_step";

type StopValidationFailureRecord = {
  readonly protocol: typeof STOP_VALIDATION_PROTOCOL;
  readonly version: typeof STOP_VALIDATION_PROTOCOL_VERSION;
  readonly type: "failure";
  readonly runId: string;
  readonly failureKind: StopValidationFailureKind;
  readonly step?: string;
  readonly exitCode?: number;
  readonly stdoutTail?: string | undefined;
  readonly stderrTail?: string | undefined;
  readonly stdoutRef?: string | undefined;
  readonly stderrRef?: string | undefined;
  readonly actionHint: string;
};

export type StopValidationProtocolContext = {
  readonly runId: string;
  readonly outputDir: string;
  readonly relativeOutputDir: string;
};

// Keep this local until repeated Stop step sets justify a shared step model/type.
const READ_ONLY_STOP_STEPS = new Set([
  "format:check",
  "lint:errors",
  "typecheck",
  "test",
  "test:project-contract",
  "generated-dependencies:check",
  "parent-tooling:check",
  "agents:check",
]);

export class UnclassifiedStopStepError extends Error {
  constructor(readonly steps: readonly string[]) {
    super(`Stop validation steps are not classified as read-only: ${steps.join(", ")}`);
    this.name = "UnclassifiedStopStepError";
  }
}

function addUnique(steps: string[], nextSteps: readonly string[]): void {
  for (const step of nextSteps) {
    if (!steps.includes(step)) {
      steps.push(step);
    }
  }
}

export function stopValidationSteps(
  scopes: Set<Scope>,
  options: {
    readonly hasParentToolingCheck: boolean;
    readonly hasAgentsCheck: boolean;
    readonly includeGeneratedDependenciesCheck?: boolean;
  },
): string[] {
  const steps: string[] = [];

  if (scopes.has("backend") || scopes.has("scripts")) {
    addUnique(steps, LIVE_STOP_VALIDATION_POLICY.codeSteps);
  }

  if (scopes.has("product")) {
    addUnique(steps, LIVE_STOP_VALIDATION_POLICY.productSteps);
  }

  if (options.includeGeneratedDependenciesCheck === true) {
    addUnique(steps, ["generated-dependencies:check"]);
  }

  if (scopes.has("config")) {
    addUnique(
      steps,
      LIVE_STOP_VALIDATION_POLICY.configSteps.filter((step) => {
        if (step === "agents:check") {
          return options.hasAgentsCheck;
        }
        if (step === "parent-tooling:check") {
          return options.hasParentToolingCheck;
        }
        return true;
      }),
    );
  }

  return steps;
}

export function unclassifiedStopSteps(steps: readonly string[]): string[] {
  return steps.filter((step) => !READ_ONLY_STOP_STEPS.has(step));
}

export function assertReadOnlyStopSteps(steps: readonly string[]): void {
  const refusedSteps = unclassifiedStopSteps(steps);
  if (refusedSteps.length > 0) {
    throw new UnclassifiedStopStepError(refusedSteps);
  }
}

export function stopValidationFiles(files: readonly string[]): string[] {
  return files.filter((file) => CODE_PATTERN.test(file) || requiresGeneratedDependencyCheck(file));
}

export function runStep(
  step: string,
  cwd: string,
  errors: string[],
  protocol?: StopValidationProtocolContext,
): void {
  const result = Bun.spawnSync(["bun", "run", "--silent", step], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) {
    if (protocol !== undefined) {
      writeProtocolRecord({
        protocol: STOP_VALIDATION_PROTOCOL,
        version: STOP_VALIDATION_PROTOCOL_VERSION,
        type: "failure",
        runId: protocol.runId,
        failureKind: "validation_failed",
        step,
        exitCode: result.exitCode,
        stdoutTail: tail(stdout, OUTPUT_TAIL_LINES),
        stderrTail: tail(stderr, OUTPUT_TAIL_LINES),
        stdoutRef: writeStepOutput(protocol, step, "stdout", stdout),
        stderrRef: writeStepOutput(protocol, step, "stderr", stderr),
        actionHint: `Run \`bun run ${step}\` outside the Stop hook and fix the failure.`,
      });
      errors.push(`[${step}] exited with code ${result.exitCode}`);
      return;
    }

    const output = [stderr, stdout].filter(Boolean).join("\n").trim();
    errors.push(`[${step}] ${output || `exited with code ${result.exitCode}`}`);
  }
}

export function runReadOnlyStopSteps(
  steps: readonly string[],
  cwd: string,
  errors: string[],
  stepRunner: (
    step: string,
    cwd: string,
    errors: string[],
    protocol?: StopValidationProtocolContext,
  ) => void = runStep,
  protocol?: StopValidationProtocolContext,
): void {
  assertReadOnlyStopSteps(steps);
  for (const step of steps) {
    stepRunner(step, cwd, errors, protocol);
  }
}

async function readStopHookInput(): Promise<StopHookInput> {
  const text = await Bun.stdin.text();
  if (text.trim() === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "stop_hook_active" in parsed &&
      typeof parsed.stop_hook_active === "boolean"
    ) {
      return { stop_hook_active: parsed.stop_hook_active };
    }
  } catch {
    return {};
  }

  return {};
}

async function hasPackageScript(projectRoot: string, scriptName: string): Promise<boolean> {
  try {
    const packageJson = (await Bun.file(`${projectRoot}/package.json`).json()) as unknown;
    return (
      typeof packageJson === "object" &&
      packageJson !== null &&
      "scripts" in packageJson &&
      typeof packageJson.scripts === "object" &&
      packageJson.scripts !== null &&
      scriptName in packageJson.scripts
    );
  } catch {
    return false;
  }
}

export function protocolContext(
  projectRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): StopValidationProtocolContext | undefined {
  const runId = env["KITSMITH_STOP_RUN_ID"];
  if (runId === undefined || runId.trim() === "") {
    return undefined;
  }

  const sessionId = sanitizePathSegment(env["KITSMITH_STOP_SESSION_ID"] ?? "anonymous");
  const relativeOutputDir = path.join(
    ".agents",
    "tmp",
    "hooks",
    "stop",
    sessionId,
    sanitizePathSegment(runId),
  );
  const outputDir = path.join(projectRoot, relativeOutputDir);
  return { runId, outputDir, relativeOutputDir };
}

function writeProtocolRecord(record: StopValidationFailureRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function writeStepOutput(
  protocol: StopValidationProtocolContext,
  step: string,
  stream: "stdout" | "stderr",
  output: string,
): string | undefined {
  if (output.length === 0) {
    return undefined;
  }

  const fileName = `${sanitizePathSegment(step)}-${stream}.txt`;
  const filePath = path.join(protocol.outputDir, fileName);
  mkdirSync(protocol.outputDir, { recursive: true, mode: 0o700 });
  chmodSync(protocol.outputDir, 0o700);
  writeFileSync(filePath, output, { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return path.join(protocol.relativeOutputDir, fileName);
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_") || "anonymous";
}

function tail(text: string, lines: number): string | undefined {
  const value = text.trim().split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
  return value.length > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const hookInput = await readStopHookInput();
  if (hookInput.stop_hook_active === true) {
    process.exit(0);
  }

  const projectRoot = resolveProjectRoot(import.meta.dir);
  const files = await getChangedFiles("working");
  const validationFiles = stopValidationFiles(files);

  if (validationFiles.length === 0) {
    process.exit(0);
  }

  const scopes = expandConfigScope(classifyScopes(validationFiles));
  const errors: string[] = [];
  const protocol = protocolContext(projectRoot);
  const steps = stopValidationSteps(scopes, {
    hasParentToolingCheck: await hasPackageScript(projectRoot, "parent-tooling:check"),
    hasAgentsCheck: await hasPackageScript(projectRoot, "agents:check"),
    includeGeneratedDependenciesCheck: validationFiles.some((file) =>
      requiresGeneratedDependencyCheck(file),
    ),
  });
  try {
    runReadOnlyStopSteps(steps, projectRoot, errors, runStep, protocol);
  } catch (error) {
    if (error instanceof UnclassifiedStopStepError) {
      if (protocol !== undefined) {
        for (const step of error.steps) {
          writeProtocolRecord({
            protocol: STOP_VALIDATION_PROTOCOL,
            version: STOP_VALIDATION_PROTOCOL_VERSION,
            type: "failure",
            runId: protocol.runId,
            failureKind: "unclassified_stop_step",
            step,
            actionHint: "Classify the Stop validation step as read-only or remove it from Stop.",
          });
        }
      } else {
        process.stderr.write(`${UNCLASSIFIED_STOP_STEP_PREFIX}: ${error.steps.join(", ")}\n`);
      }
      process.exit(3);
    }
    throw error;
  }

  if (errors.length > 0) {
    if (protocol === undefined) {
      process.stderr.write(`Validation failed:\n${errors.join("\n\n")}\n`);
    }
    process.exit(2);
  }
}

if (import.meta.main) {
  await main();
}
