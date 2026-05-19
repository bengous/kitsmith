#!/usr/bin/env bun

import { expandConfigScope, getChangedScopes } from "./internal/detect-scope.ts";
import { resolveProjectRoot } from "./internal/resolve-bin.ts";
import { GENERATED_PROJECT_PUSH_VALIDATION_POLICY } from "./internal/validation-plan.ts";
import {
  resolveValidationStepCommand,
  runGeneratedValidationStep,
} from "./internal/validation-runner.ts";

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot(import.meta.dir);
  const scopes = expandConfigScope(await getChangedScopes("push"));

  if (scopes.size === 0) {
    console.log("No scoped changes detected, skipping validation.");
    process.exit(0);
  }

  const errors: string[] = [];

  async function runScript(script: string): Promise<void> {
    const command = resolveValidationStepCommand(script, projectRoot);
    if (command !== undefined) {
      const result = runGeneratedValidationStep(script, projectRoot);
      if (result.exit !== 0) {
        errors.push(`[${result.step}] ${result.output || `exited with code ${result.exit}`}`);
      }
      return;
    }

    const result = Bun.spawnSync([process.execPath, "run", "--silent", script], {
      cwd: projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      ...(process.platform === "win32" ? { windowsHide: true } : {}),
    });
    if (result.exitCode !== 0) {
      const output = [result.stderr.toString(), result.stdout.toString()]
        .filter(Boolean)
        .join("\n")
        .trim();
      errors.push(`[${script}] ${output || `exited with code ${result.exitCode}`}`);
    }
  }

  async function runSteps(steps: readonly string[]): Promise<void> {
    for (const step of steps) {
      await runScript(step);
    }
  }

  if (scopes.has("backend") || scopes.has("scripts")) {
    await runSteps(GENERATED_PROJECT_PUSH_VALIDATION_POLICY.codeSteps);
  }
  if (scopes.has("frontend")) {
    await runSteps(GENERATED_PROJECT_PUSH_VALIDATION_POLICY.frontendSteps);
  }

  if (errors.length > 0) {
    console.error(`Push validation failed:\n\n${errors.join("\n\n")}`);
    process.exit(1);
  }

  console.log(`Push validation passed (scopes: ${[...scopes].join(", ")}).`);
}

if (import.meta.main) {
  await main();
}
