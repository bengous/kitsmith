#!/usr/bin/env bun

import {
  CODE_PATTERN,
  classifyScopes,
  expandConfigScope,
  getChangedFiles,
} from "./internal/detect-scope.ts";
import { resolveProjectRoot } from "./internal/resolve-bin.ts";
import { runGeneratedValidationStep } from "./internal/validation-runner.ts";

function runGeneratedStep(step: string, cwd: string, errors: string[]): void {
  const result = runGeneratedValidationStep(step, cwd);
  if (result.exit !== 0) {
    errors.push(`[${result.step}] ${result.output || `exited with code ${result.exit}`}`);
  }
}

async function hasAgentSync(projectRoot: string): Promise<boolean> {
  return Bun.file(`${projectRoot}/scripts/agents/sync-agents-md.ts`).exists();
}

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot(import.meta.dir);
  const files = await getChangedFiles("working");
  const codeFiles = files.filter((file) => CODE_PATTERN.test(file));

  if (codeFiles.length === 0) {
    process.exit(0);
  }

  const scopes = expandConfigScope(classifyScopes(codeFiles));
  const errors: string[] = [];

  if (scopes.has("backend") || scopes.has("scripts")) {
    runGeneratedStep("format:check", projectRoot, errors);
    runGeneratedStep("lint:errors", projectRoot, errors);
    runGeneratedStep("typecheck", projectRoot, errors);
    runGeneratedStep("test", projectRoot, errors);
  }
  if (scopes.has("frontend")) {
    runGeneratedStep("typecheck:frontend", projectRoot, errors);
    runGeneratedStep("lint:frontend", projectRoot, errors);
    runGeneratedStep("lint:css:frontend", projectRoot, errors);
    runGeneratedStep("format:check:frontend", projectRoot, errors);
  }

  if (scopes.has("config") && (await hasAgentSync(projectRoot))) {
    runGeneratedStep("agents:check", projectRoot, errors);
  }

  if (errors.length > 0) {
    process.stderr.write(`Validation failed:\n${errors.join("\n\n")}\n`);
    process.exit(2);
  }
}

if (import.meta.main) {
  await main();
}
