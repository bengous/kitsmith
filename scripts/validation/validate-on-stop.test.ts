import { expect, test } from "bun:test";
import { stopValidationFiles, stopValidationSteps } from "./validate-on-stop.ts";

test("stop validation targets code changes with check-level steps", () => {
  expect(
    stopValidationSteps(new Set(["backend", "scripts"]), {
      hasParentToolingCheck: true,
      hasAgentsCheck: true,
    }),
  ).toEqual(["format:check", "lint:errors", "typecheck", "test"]);
});

test("stop validation runs generated dependency checks before product contract checks", () => {
  expect(
    stopValidationSteps(new Set(["product"]), {
      hasParentToolingCheck: true,
      hasAgentsCheck: true,
      includeGeneratedDependenciesCheck: true,
    }),
  ).toEqual(["format:check", "test:project-contract", "generated-dependencies:check"]);
});

test("stop validation includes config sync checks without deep or sandbox lanes", () => {
  expect(
    stopValidationSteps(new Set(["config", "backend", "scripts", "product"]), {
      hasParentToolingCheck: true,
      hasAgentsCheck: true,
      includeGeneratedDependenciesCheck: true,
    }),
  ).toEqual([
    "format:check",
    "lint:errors",
    "typecheck",
    "test",
    "test:project-contract",
    "generated-dependencies:check",
    "parent-tooling:check",
    "agents:check",
  ]);
});

test("stop validation includes generated dependency Pkl files", () => {
  expect(
    stopValidationFiles([
      "config/generated-dependencies/baseline.pkl",
      "assets/brand/logo.png",
      "src/core/generated-project-contract.ts",
    ]),
  ).toEqual([
    "config/generated-dependencies/baseline.pkl",
    "src/core/generated-project-contract.ts",
  ]);
});
