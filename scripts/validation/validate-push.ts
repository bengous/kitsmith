#!/usr/bin/env bun

import type { Scope } from "./detect-scope";
import { isParentToolingSyncPath, isParentToolingSyncTargetPath } from "../sync/parent-tooling.ts";
import { classifyScopes, expandConfigScope, getChangedFiles } from "./detect-scope";
import { resolveProjectRoot } from "./resolve-bin";
import { LIVE_PUSH_VALIDATION_POLICY } from "./validation-plan.ts";

type PushValidationOptions = {
  readonly includeParentToolingCheck?: boolean;
};

function addUnique(target: string[], steps: readonly string[]): void {
  for (const step of steps) {
    if (!target.includes(step)) {
      target.push(step);
    }
  }
}

export function pushValidationSteps(
  scopes: ReadonlySet<Scope>,
  options: PushValidationOptions = {},
): string[] {
  const steps: string[] = [];
  const validatesCode = scopes.has("backend") || scopes.has("scripts");

  if (validatesCode) {
    addUnique(steps, LIVE_PUSH_VALIDATION_POLICY.codeSteps);
  }

  if (scopes.has("product")) {
    if (!validatesCode) {
      addUnique(steps, [LIVE_PUSH_VALIDATION_POLICY.productFormatStep]);
    }
    addUnique(steps, LIVE_PUSH_VALIDATION_POLICY.productSteps);
  }

  if (scopes.has("config")) {
    addUnique(steps, LIVE_PUSH_VALIDATION_POLICY.configSteps);
  } else if (options.includeParentToolingCheck) {
    addUnique(steps, ["parent-tooling:check"]);
  }

  return steps;
}

export function changedFilesRequireParentToolingCheck(files: readonly string[]): boolean {
  return files.some((file) => isParentToolingSyncPath(file));
}

export function dirtyParentToolingTargetPaths(files: readonly string[]): string[] {
  return files.filter((file) => isParentToolingSyncTargetPath(file)).toSorted();
}

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot(import.meta.dir);
  const pushFiles = await getChangedFiles("push");
  const scopes = expandConfigScope(classifyScopes(pushFiles));
  const requiresParentToolingCheck = changedFilesRequireParentToolingCheck(pushFiles);

  if (scopes.size === 0) {
    console.log("No scoped changes detected, skipping validation.");
    process.exit(0);
  }

  const errors: string[] = [];

  async function runScript(script: string): Promise<void> {
    const result = await Bun.$`bun run --silent ${script}`.cwd(projectRoot).nothrow().quiet();
    if (result.exitCode !== 0) {
      const output = [result.stderr.toString(), result.stdout.toString()]
        .filter(Boolean)
        .join("\n")
        .trim();
      errors.push(`[${script}] ${output || `exited with code ${result.exitCode}`}`);
    }
  }

  for (const step of pushValidationSteps(scopes, {
    includeParentToolingCheck: requiresParentToolingCheck,
  })) {
    await runScript(step);
  }

  if (requiresParentToolingCheck) {
    const dirtyTargets = dirtyParentToolingTargetPaths(await getChangedFiles("working"));
    if (dirtyTargets.length > 0) {
      errors.push(
        [
          "[parent-tooling:clean] Parent tooling sync output has uncommitted changes:",
          ...dirtyTargets.map((path) => `- ${path}`),
          "Commit the sync output before pushing.",
        ].join("\n"),
      );
    }
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
