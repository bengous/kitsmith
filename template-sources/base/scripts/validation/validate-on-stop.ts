#!/usr/bin/env bun

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CODE_PATTERN,
  classifyScopes,
  expandConfigScope,
  getChangedFiles,
} from "./internal/detect-scope.ts";
import { resolveProjectRoot } from "./internal/resolve-bin.ts";
import { runGeneratedValidationStep } from "./internal/validation-runner.ts";

export const STOP_VALIDATION_PROTOCOL = "kitsmith.stop-validation";
export const STOP_VALIDATION_PROTOCOL_VERSION = 1;
const OUTPUT_TAIL_LINES = 40;

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
  "typecheck:frontend",
  "lint:frontend",
  "lint:css:frontend",
  "format:check:frontend",
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

export function unclassifiedStopSteps(steps: readonly string[]): string[] {
  return steps.filter((step) => !READ_ONLY_STOP_STEPS.has(step));
}

export function assertReadOnlyStopSteps(steps: readonly string[]): void {
  const refusedSteps = unclassifiedStopSteps(steps);
  if (refusedSteps.length > 0) {
    throw new UnclassifiedStopStepError(refusedSteps);
  }
}

export function stopValidationSteps(scopes: Set<string>, hasAgentSync: boolean): string[] {
  const steps: string[] = [];
  if (scopes.has("backend") || scopes.has("scripts")) {
    addUnique(steps, ["format:check", "lint:errors", "typecheck", "test"]);
  }
  if (scopes.has("frontend")) {
    addUnique(steps, [
      "typecheck:frontend",
      "lint:frontend",
      "lint:css:frontend",
      "format:check:frontend",
    ]);
  }
  if (scopes.has("config") && hasAgentSync) {
    addUnique(steps, ["agents:check"]);
  }
  return steps;
}

export function stopValidationFiles(files: readonly string[]): string[] {
  return files.filter((file) => CODE_PATTERN.test(file));
}

export function runGeneratedStep(
  step: string,
  cwd: string,
  errors: string[],
  protocol?: StopValidationProtocolContext,
): void {
  const result = runGeneratedValidationStep(step, cwd);
  if (result.exit === 0) {
    return;
  }

  if (protocol !== undefined) {
    writeProtocolRecord({
      protocol: STOP_VALIDATION_PROTOCOL,
      version: STOP_VALIDATION_PROTOCOL_VERSION,
      type: "failure",
      runId: protocol.runId,
      failureKind: "validation_failed",
      step: result.step,
      exitCode: result.exit,
      stdoutTail: tail(result.stdout, OUTPUT_TAIL_LINES),
      stderrTail: tail(result.stderr, OUTPUT_TAIL_LINES),
      stdoutRef: writeStepOutput(protocol, result.step, "stdout", result.stdout),
      stderrRef: writeStepOutput(protocol, result.step, "stderr", result.stderr),
      actionHint: `Run \`bun run ${result.step}\` outside the Stop hook and fix the failure.`,
    });
    errors.push(`[${result.step}] exited with code ${result.exit}`);
    return;
  }

  errors.push(`[${result.step}] ${result.output || `exited with code ${result.exit}`}`);
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
  ) => void = runGeneratedStep,
  protocol?: StopValidationProtocolContext,
): void {
  assertReadOnlyStopSteps(steps);
  for (const step of steps) {
    stepRunner(step, cwd, errors, protocol);
  }
}

async function hasAgentSync(projectRoot: string): Promise<boolean> {
  return Bun.file(`${projectRoot}/scripts/agents/sync-agents-md.ts`).exists();
}

function protocolContext(projectRoot: string): StopValidationProtocolContext | undefined {
  const runId = process.env["KITSMITH_STOP_RUN_ID"];
  if (runId === undefined || runId.trim() === "") {
    return undefined;
  }

  const sessionId = sanitizePathSegment(process.env["KITSMITH_STOP_SESSION_ID"] ?? "anonymous");
  const relativeOutputDir = path.join(
    ".agents",
    "tmp",
    "hooks",
    "stop",
    sessionId,
    sanitizePathSegment(runId),
  );
  const outputDir = path.join(projectRoot, relativeOutputDir);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  chmodSync(outputDir, 0o700);
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
  chmodSync(protocol.outputDir, 0o700);
  writeFileSync(filePath, output, { mode: 0o600 });
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
  const projectRoot = resolveProjectRoot(import.meta.dir);
  const files = await getChangedFiles("working");
  const codeFiles = stopValidationFiles(files);

  if (codeFiles.length === 0) {
    process.exit(0);
  }

  const scopes = expandConfigScope(classifyScopes(codeFiles));
  const errors: string[] = [];
  const protocol = protocolContext(projectRoot);
  const steps = stopValidationSteps(scopes, await hasAgentSync(projectRoot));

  try {
    runReadOnlyStopSteps(steps, projectRoot, errors, runGeneratedStep, protocol);
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
        process.stderr.write(`STOP_UNCLASSIFIED_STEP: ${error.steps.join(", ")}\n`);
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
