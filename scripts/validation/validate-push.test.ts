import type { Scope } from "./detect-scope";
import { expect, test } from "bun:test";
import {
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
  ).toEqual(["format:check", "test:project-contract", "parent-tooling:check"]);
});

test("push validation detects parent tooling source and target changes", () => {
  expect(
    changedFilesRequireParentToolingCheck([
      "template-sources/ai/.codex/hooks/guard-destructive.ts",
    ]),
  ).toBe(true);
  expect(changedFilesRequireParentToolingCheck(["templates/package.json.tpl"])).toBe(false);
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
