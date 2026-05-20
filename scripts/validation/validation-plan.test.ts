import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { objectField, parseJsonObject } from "../../src/core/json.ts";
import {
  GENERATED_PROJECT_CHECK_PLAN,
  GENERATED_PROJECT_PUSH_VALIDATION_POLICY,
  GENERATED_PROJECT_VALIDATE_PLAN,
} from "../../template-sources/base/scripts/validation/internal/validation-plan.ts";
import {
  LIVE_CHECK_PLAN,
  LIVE_DEEP_PLAN,
  LIVE_GENERATED_PLAN,
  LIVE_PUSH_VALIDATION_POLICY,
  LIVE_SANDBOX_PLAN,
  LIVE_STOP_VALIDATION_POLICY,
  LIVE_VALIDATE_PLAN,
} from "./validation-plan.ts";

const packageScripts = objectField(
  parseJsonObject(readFileSync("package.json", "utf8"), "package.json"),
  "scripts",
);

const generatedContractSteps = ["test:project-contract"];
const generatedDependencyCheckStep = "generated-dependencies:check";
const sandboxE2eInstallSmokeSteps = ["test:e2e-contract", "test:safe-install", "test:smoke"];
const releaseAndSandboxSteps = new Set([
  "release:prepare",
  "test:e2e-contract",
  "test:safe-install",
  "test:smoke",
]);

test("live package scripts expose thin maintainer lane entrypoints", () => {
  expect(packageScripts["autofix"]).toBe("bun scripts/validation/autofix.ts");
  expect(packageScripts["check"]).toBe("bun scripts/validation/validate.ts --plan check");
  expect(packageScripts["validate"]).toBe("bun scripts/validation/validate.ts");
  expect(packageScripts["validate:deep"]).toBe("bun scripts/validation/validate.ts --plan deep");
  expect(packageScripts["validate:generated"]).toBe(
    "bun scripts/validation/validate.ts --plan generated",
  );
  expect(packageScripts["validate:sandbox"]).toBe(
    "bun scripts/validation/validate.ts --plan sandbox",
  );
  expect(packageScripts["release:prepare"]).toBe("bun scripts/release/prepare.ts");
  expect(packageScripts["validate:scale"]).toBeUndefined();
});

test("live check plan is fast read-only and excludes deep, sandbox, and release lanes", () => {
  expect(LIVE_CHECK_PLAN.defaultSteps).toEqual([
    "generated-dependencies:check",
    "parent-tooling:check",
    "agents:check",
    "format:check",
    "lint:errors",
    "typecheck",
    "test",
  ]);
  expect(LIVE_CHECK_PLAN.defaultSteps).not.toContain("lint:dead");
  expect(LIVE_CHECK_PLAN.defaultSteps).not.toContain("lint:dupes");
  expect(LIVE_CHECK_PLAN.defaultSteps).not.toContain("check:github-actions");
  expect(LIVE_CHECK_PLAN.defaultSteps).not.toContain("check:github-actions-security");
  expect(LIVE_CHECK_PLAN.defaultSteps).not.toContain("check:links");
  for (const step of releaseAndSandboxSteps) {
    expect(LIVE_CHECK_PLAN.defaultSteps).not.toContain(step);
  }
});

test("live validate plan keeps live-only rails out of generated validation", () => {
  expect(LIVE_VALIDATE_PLAN.defaultSteps).toContain(generatedDependencyCheckStep);
  expect(LIVE_VALIDATE_PLAN.defaultSteps).toContain("parent-tooling:check");
  expect(LIVE_VALIDATE_PLAN.defaultSteps).toContain("lint:arch");
  expect(LIVE_VALIDATE_PLAN.defaultSteps).toContain("lint:audit");
  expect(LIVE_VALIDATE_PLAN.defaultSteps).not.toContain("validate:frontend");
});

test("live deep, generated, sandbox, and release lanes stay separated", () => {
  for (const step of LIVE_VALIDATE_PLAN.defaultSteps) {
    expect(LIVE_DEEP_PLAN.defaultSteps).toContain(step);
  }
  expect(LIVE_DEEP_PLAN.defaultSteps).toContain("lint:dead");
  expect(LIVE_DEEP_PLAN.defaultSteps).toContain("lint:dupes");
  expect(LIVE_DEEP_PLAN.defaultSteps).toContain(generatedDependencyCheckStep);
  expect(LIVE_DEEP_PLAN.defaultSteps).toContain("check:github-actions");
  expect(LIVE_DEEP_PLAN.defaultSteps).toContain("check:github-actions-security");
  expect(LIVE_DEEP_PLAN.defaultSteps).toContain("check:links");
  expect(LIVE_DEEP_PLAN.defaultSteps).not.toContain("test:e2e-contract");
  expect(LIVE_DEEP_PLAN.defaultSteps).not.toContain("test:safe-install");
  expect(LIVE_DEEP_PLAN.defaultSteps).not.toContain("release:prepare");

  expect(LIVE_GENERATED_PLAN.orderedPrerequisites).toEqual([generatedDependencyCheckStep]);
  expect(LIVE_GENERATED_PLAN.defaultSteps).toEqual(generatedContractSteps);
  expect(LIVE_SANDBOX_PLAN.defaultSteps).toEqual(sandboxE2eInstallSmokeSteps);
  for (const plan of [LIVE_VALIDATE_PLAN, LIVE_DEEP_PLAN, LIVE_GENERATED_PLAN, LIVE_SANDBOX_PLAN]) {
    expect(plan.defaultSteps).not.toContain("release:prepare");
  }
});

test("live sandbox lane owns e2e, disposable install, smoke, and supply-chain checks", () => {
  expect(packageScripts["validate:sandbox"]).toBe(
    "bun scripts/validation/validate.ts --plan sandbox",
  );
  expect(packageScripts["validate:supply-chain"]).toBeUndefined();
  expect(LIVE_SANDBOX_PLAN.defaultSteps).toEqual(sandboxE2eInstallSmokeSteps);

  const commandText = LIVE_SANDBOX_PLAN.defaultSteps
    .map((step) => `${step}: ${String(packageScripts[step])}`)
    .join("\n");
  expect(commandText).toContain("e2e-contract.ts");
  expect(commandText).toContain("safe-install-smoke.ts");
  expect(commandText).toContain("smoke.ts");
  for (const forbidden of [
    "release:prepare",
    "scripts/release",
    "prepack",
    "npm publish",
    "npm pack",
    "git tag",
    "git push",
  ]) {
    expect(commandText).not.toContain(forbidden);
  }
});

test("copied generated validation sources use top-level type-only imports", () => {
  for (const sourcePath of [
    "template-sources/base/scripts/validation/internal/detect-scope.ts",
    "template-sources/base/scripts/validation/validate.ts",
    "template-sources/base/scripts/validation/shared/quality-scope-policy.ts",
  ]) {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*\btype\s+/s);
  }
});

test("live generated lane is host-safe product contract coverage", () => {
  expect(LIVE_GENERATED_PLAN.orderedPrerequisites).toEqual([generatedDependencyCheckStep]);
  expect(LIVE_GENERATED_PLAN.defaultSteps).toEqual(generatedContractSteps);
  for (const excluded of [
    "test:e2e-contract",
    "test:safe-install",
    "test:smoke",
    "release:prepare",
    "build",
    "prepack",
  ]) {
    expect(LIVE_GENERATED_PLAN.defaultSteps).not.toContain(excluded);
  }
});

test("live push policy keeps product contract validation explicit", () => {
  expect(LIVE_PUSH_VALIDATION_POLICY.productSteps[0]).toBe(generatedDependencyCheckStep);
  expect(LIVE_PUSH_VALIDATION_POLICY.productSteps).toContain("test:project-contract");
  expect(LIVE_PUSH_VALIDATION_POLICY.productSteps).not.toContain("validate:frontend");
  expect(LIVE_PUSH_VALIDATION_POLICY.configSteps).toEqual([
    generatedDependencyCheckStep,
    "parent-tooling:check",
    "agents:check",
  ]);
  for (const forbidden of [
    "validate:deep",
    "validate:generated",
    "validate:sandbox",
    "test:safe-install",
    "test:smoke",
    "release:prepare",
    "prepack",
  ]) {
    expect([
      ...LIVE_PUSH_VALIDATION_POLICY.codeSteps,
      LIVE_PUSH_VALIDATION_POLICY.productFormatStep,
      ...LIVE_PUSH_VALIDATION_POLICY.productSteps,
      ...LIVE_PUSH_VALIDATION_POLICY.configSteps,
    ]).not.toContain(forbidden);
  }
});

test("live stop policy stays targeted to check-level steps", () => {
  expect(LIVE_STOP_VALIDATION_POLICY.codeSteps).toEqual([
    "format:check",
    "lint:errors",
    "typecheck",
    "test",
  ]);
  expect(LIVE_STOP_VALIDATION_POLICY.productSteps).toEqual([
    "format:check",
    "test:project-contract",
  ]);
  expect(LIVE_STOP_VALIDATION_POLICY.configSteps).toEqual(["parent-tooling:check", "agents:check"]);

  for (const step of [
    ...LIVE_STOP_VALIDATION_POLICY.codeSteps,
    ...LIVE_STOP_VALIDATION_POLICY.configSteps,
  ]) {
    expect(LIVE_CHECK_PLAN.defaultSteps).toContain(step);
  }
  for (const forbidden of [
    "validate",
    "validate:deep",
    "validate:generated",
    "validate:sandbox",
    "release:prepare",
    "lint:arch",
    "lint:audit",
    "lint:dead",
    "lint:dupes",
    "check:github-actions",
    "check:github-actions-security",
    "check:links",
  ]) {
    expect([
      ...LIVE_STOP_VALIDATION_POLICY.codeSteps,
      ...LIVE_STOP_VALIDATION_POLICY.productSteps,
      ...LIVE_STOP_VALIDATION_POLICY.configSteps,
    ]).not.toContain(forbidden);
  }
});

test("maintainer validation docs map old commands and delegate domain-specific contracts", () => {
  const docs = readFileSync("docs/maintainer-validation.md", "utf8");
  for (const expected of [
    "| `validate` | `validate` |",
    "| `validate:scale` | removed |",
    "| `lint:dead` | `validate:deep` |",
    "| `lint:dupes` | `validate:deep` |",
    "| `check:github-actions` | `validate:deep` |",
    "| `check:github-actions-security` | `validate:deep` |",
    "| `check:links` | `validate:deep` |",
    "| `test:e2e-contract` | `validate:sandbox` |",
    "| `test:smoke` | `validate:sandbox` |",
    "| `test:safe-install` | `validate:sandbox` |",
    "| supply-chain probe | `validate:sandbox` |",
    "| tarball smoke | `release:prepare` |",
    "| `release:prepare` | `release:prepare` |",
  ]) {
    expect(docs).toContain(expected);
  }

  expect(docs).toContain("Linux/bubblewrap");
  expect(docs).toContain("must not run bubblewrap sandboxes");
  expect(docs).toContain("network-enabled generated-project");
  expect(docs).toContain("temporary projects under the OS temp directory");
  expect(docs).toContain("supply-chain probe runs inside `test:safe-install`");
  expect(docs).toContain("publish, tag, push");
  expect(docs).toContain("Internal leaves");
  expect(docs).toContain("Generated Dependency Baseline");
  expect(docs).toContain("docs/generated-dependencies/CONTRACT.md");
  expect(docs).toContain("docs/generated-dependencies/UBIQUITOUS_LANGUAGE.md");
  expect(docs).toContain("generated-dependencies:check");
});

test("every live validation plan package step has a package script", () => {
  const planSteps = new Set([
    ...LIVE_CHECK_PLAN.defaultSteps,
    ...LIVE_VALIDATE_PLAN.defaultSteps,
    ...LIVE_DEEP_PLAN.defaultSteps,
    ...(LIVE_GENERATED_PLAN.orderedPrerequisites ?? []),
    ...LIVE_GENERATED_PLAN.defaultSteps,
    ...LIVE_SANDBOX_PLAN.defaultSteps,
    ...LIVE_PUSH_VALIDATION_POLICY.codeSteps,
    LIVE_PUSH_VALIDATION_POLICY.productFormatStep,
    ...LIVE_PUSH_VALIDATION_POLICY.productSteps,
    ...LIVE_PUSH_VALIDATION_POLICY.configSteps,
    ...LIVE_STOP_VALIDATION_POLICY.codeSteps,
    ...LIVE_STOP_VALIDATION_POLICY.productSteps,
    ...LIVE_STOP_VALIDATION_POLICY.configSteps,
  ]);

  for (const step of planSteps) {
    expect(packageScripts[step], step).toBeString();
  }
});

test("CI and release workflows install Pkl before generated dependency checks can run", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const releasePrepare = readFileSync(".github/workflows/release-prepare.yml", "utf8");

  for (const job of ["quality-linux", "quality-windows", "generated-linux", "generated-windows"]) {
    const jobStart = ci.indexOf(`  ${job}:`);
    expect(jobStart, job).toBeGreaterThanOrEqual(0);
    const nextJob = ci.slice(jobStart + 1).search(/\n  [a-z][a-z-]+:/);
    const jobEnd = nextJob === -1 ? undefined : jobStart + 1 + nextJob;
    const jobText = ci.slice(jobStart, jobEnd);
    expect(jobText, job).toContain("jdx/mise-action");
    expect(jobText, job).toContain("install_args: pkl");
    expect(jobText.indexOf("install_args: pkl"), job).toBeLessThan(jobText.indexOf("Validate"));
  }

  expect(releasePrepare).toContain("install_args: pkl cocogitto");
  expect(releasePrepare.indexOf("install_args: pkl cocogitto")).toBeLessThan(
    releasePrepare.indexOf("Prepare release"),
  );
});

test("generated project tool configuration remains Pkl-free", () => {
  const generatedMise = readFileSync("template-sources/base/mise.toml", "utf8");
  expect(generatedMise).not.toMatch(/^pkl\s*=/m);
});

test("generated check plan is a fast read-only subset of generated validate", () => {
  expect(GENERATED_PROJECT_CHECK_PLAN.defaultSteps).toEqual([
    "format:check",
    "lint:errors",
    "typecheck",
    "test",
  ]);

  for (const step of GENERATED_PROJECT_CHECK_PLAN.defaultSteps) {
    expect(GENERATED_PROJECT_VALIDATE_PLAN.defaultSteps).toContain(step);
  }

  expect(GENERATED_PROJECT_CHECK_PLAN.defaultSteps).not.toContain("lint:dead");
  expect(GENERATED_PROJECT_CHECK_PLAN.defaultSteps).not.toContain("lint:dupes");
  expect(GENERATED_PROJECT_CHECK_PLAN.defaultSteps).not.toContain("validate:frontend");
  expect(GENERATED_PROJECT_VALIDATE_PLAN.defaultSteps).toContain("build:frontend");
  expect(GENERATED_PROJECT_VALIDATE_PLAN.defaultSteps).toContain("test:e2e");
  expect(GENERATED_PROJECT_VALIDATE_PLAN.defaultSteps).not.toContain("validate:frontend");
  expect(GENERATED_PROJECT_VALIDATE_PLAN.defaultSteps).not.toContain("release:prepare");
  expect(GENERATED_PROJECT_VALIDATE_PLAN.defaultSteps).not.toContain("validate:sandbox");
  expect([
    ...GENERATED_PROJECT_PUSH_VALIDATION_POLICY.codeSteps,
    ...GENERATED_PROJECT_PUSH_VALIDATION_POLICY.frontendSteps,
  ]).not.toContain("parent-tooling:check");
});
