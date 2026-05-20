#!/usr/bin/env bun

import type { Scope } from "./detect-scope";
import { CODE_PATTERN, classifyScopes, expandConfigScope, getChangedFiles } from "./detect-scope";
import { resolveProjectRoot } from "./resolve-bin";
import { requiresGeneratedDependencyCheck } from "./routing-policy.ts";
import { LIVE_STOP_VALIDATION_POLICY } from "./validation-plan.ts";

export const UNCLASSIFIED_STOP_STEP_PREFIX = "STOP_UNCLASSIFIED_STEP";

type StopHookInput = {
  readonly stop_hook_active?: boolean;
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

  if (options.includeGeneratedDependenciesCheck) {
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

function runStep(step: string, cwd: string, errors: string[]): void {
  const result = Bun.spawnSync(["bun", "run", "--silent", step], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const output = [result.stderr.toString(), result.stdout.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    errors.push(`[${step}] ${output || `exited with code ${result.exitCode}`}`);
  }
}

export function runReadOnlyStopSteps(
  steps: readonly string[],
  cwd: string,
  errors: string[],
  stepRunner: (step: string, cwd: string, errors: string[]) => void = runStep,
): void {
  assertReadOnlyStopSteps(steps);
  for (const step of steps) {
    stepRunner(step, cwd, errors);
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
  const steps = stopValidationSteps(scopes, {
    hasParentToolingCheck: await hasPackageScript(projectRoot, "parent-tooling:check"),
    hasAgentsCheck: await hasPackageScript(projectRoot, "agents:check"),
    includeGeneratedDependenciesCheck: validationFiles.some((file) =>
      requiresGeneratedDependencyCheck(file),
    ),
  });
  try {
    runReadOnlyStopSteps(steps, projectRoot, errors);
  } catch (error) {
    if (error instanceof UnclassifiedStopStepError) {
      process.stderr.write(`${UNCLASSIFIED_STOP_STEP_PREFIX}: ${error.steps.join(", ")}\n`);
      process.exit(3);
    }
    throw error;
  }

  if (errors.length > 0) {
    process.stderr.write(`Validation failed:\n${errors.join("\n\n")}\n`);
    process.exit(2);
  }
}

if (import.meta.main) {
  await main();
}
