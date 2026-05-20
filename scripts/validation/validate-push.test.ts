import type { Scope } from "./detect-scope";
import { expect, test } from "bun:test";
import {
  changedFilesRequireGeneratedDependenciesCheck,
  changedFilesRequireParentToolingCheck,
  dirtyParentToolingTargetPaths,
  pushValidationSteps,
} from "./validate-push.ts";

test("push validation includes config sync checks for config changes", () => {
  expect(pushValidationSteps(new Set<Scope>(["config", "backend", "scripts", "product"]))).toEqual([
    "typecheck",
    "lint:errors",
    "format:check",
    "lint:arch",
    "test",
    "generated-dependencies:check",
    "test:project-contract",
    "parent-tooling:check",
    "agents:check",
  ]);
});

test("push validation checks parent tooling drift when managed product sources change", () => {
  expect(
    pushValidationSteps(new Set<Scope>(["product"]), {
      includeParentToolingCheck: true,
    }),
  ).toEqual([
    "format:check",
    "generated-dependencies:check",
    "test:project-contract",
    "parent-tooling:check",
  ]);
});

test("push validation forces generated dependency checks for dependency baseline surfaces", () => {
  expect(
    pushValidationSteps(new Set<Scope>(["backend"]), {
      includeGeneratedDependenciesCheck: true,
    }),
  ).toEqual([
    "generated-dependencies:check",
    "typecheck",
    "lint:errors",
    "format:check",
    "lint:arch",
    "test",
  ]);
});

test("push validation detects parent tooling source and target changes", () => {
  expect(
    changedFilesRequireParentToolingCheck([
      "template-sources/ai/.codex/hooks/guard-destructive.ts",
    ]),
  ).toBe(true);
  expect(changedFilesRequireParentToolingCheck(["templates/package.json.tpl"])).toBe(false);
});

test("push validation detects generated dependency baseline source and related surfaces", () => {
  for (const path of [
    "config/generated-dependencies/GeneratedDependencies.pkl",
    "config/generated-dependencies/baseline.pkl",
    "src/core/generated-dependencies.generated.ts",
    "package.json",
    "bun.lock",
    "templates/package.json.tpl",
    "template-sources/base/.oxlintrc.jsonc",
  ]) {
    expect(changedFilesRequireGeneratedDependenciesCheck([path]), path).toBe(true);
  }

  expect(changedFilesRequireGeneratedDependenciesCheck(["src/index.ts"])).toBe(false);
});

test("push validation blocks uncommitted managed targets without blocking generated guidance", () => {
  expect(
    dirtyParentToolingTargetPaths([
      ".codex/hooks/guard-destructive.ts",
      ".codex/hooks/AGENTS.md",
      "template-sources/ai/.codex/hooks/guard-destructive.ts",
    ]),
  ).toEqual([".codex/hooks/guard-destructive.ts"]);
});
