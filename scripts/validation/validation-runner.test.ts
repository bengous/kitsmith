import type { ValidationResult } from "./validation-runner.ts";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveValidationStepCommand,
  runGeneratedValidationStep,
} from "../../template-sources/base/scripts/validation/internal/validation-runner.ts";
import { summarizeValidationResults } from "./validation-runner.ts";

function result(step: string, exit: number): ValidationResult {
  return { step, exit, output: "", ms: 1 };
}

function localToolCommand(name: string, args: readonly string[] = []): string[] {
  return [process.execPath, "run", "--no-install", "--silent", name, ...args];
}

describe("summarizeValidationResults", () => {
  test("counts passed and failed validation results", () => {
    expect(
      summarizeValidationResults([result("typecheck", 0), result("lint", 1), result("test", 0)]),
    ).toEqual({
      total: 3,
      passed: 2,
      failed: 1,
    });
  });

  test("handles empty validation plans", () => {
    expect(summarizeValidationResults([])).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
    });
  });
});

describe("generated validation runner command resolution", () => {
  test("resolves hidden base validation leaves without package script aliases", () => {
    expect(resolveValidationStepCommand("format:check")?.command).toContain("-c");
    expect(resolveValidationStepCommand("lint:errors")?.command).toContain("--quiet");
    expect(resolveValidationStepCommand("typecheck")?.command).toContain("--noEmit");
  });

  test("resolves hidden test from generated project surfaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-runner-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      mkdirSync(join(dir, "apps/frontend"), { recursive: true });
      mkdirSync(join(dir, ".agents/scripts/hooks"), { recursive: true });
      mkdirSync(join(dir, ".codex/hooks"), { recursive: true });
      mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
      writeFileSync(join(dir, "apps/frontend/package.json"), "{}");

      expect(resolveValidationStepCommand("test", dir)).toMatchObject({
        step: "test",
        command: [process.execPath, "test", "./src"],
        sequence: [
          { command: [process.execPath, "test", "./src"] },
          { cwd: "apps/frontend", command: [process.execPath, "run", "--silent", "test"] },
          {
            command: [
              process.execPath,
              "test",
              "./.codex/hooks",
              "./.claude/hooks",
              "./.agents/scripts/hooks",
            ],
          },
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves hidden test for frontend-only generated projects without root src", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-runner-"));
    try {
      mkdirSync(join(dir, "apps/frontend"), { recursive: true });
      writeFileSync(join(dir, "apps/frontend/package.json"), "{}");

      expect(resolveValidationStepCommand("test", dir)).toMatchObject({
        step: "test",
        command: [process.execPath, "run", "--silent", "test"],
        cwd: "apps/frontend",
        sequence: [
          { cwd: "apps/frontend", command: [process.execPath, "run", "--silent", "test"] },
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs hidden test for frontend-only generated projects through the frontend package", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-runner-"));
    try {
      mkdirSync(join(dir, "apps/frontend"), { recursive: true });
      writeFileSync(
        join(dir, "apps/frontend/package.json"),
        JSON.stringify({ scripts: { test: "bun ./frontend-test.ts" } }),
      );
      writeFileSync(
        join(dir, "apps/frontend/frontend-test.ts"),
        'await Bun.write("ran.txt", "ok");',
      );

      const result = runGeneratedValidationStep("test", dir);

      expect(result.exit).toBe(0);
      expect(existsSync(join(dir, "apps/frontend/ran.txt"))).toBe(true);
      expect(existsSync(join(dir, "src"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not resolve maintainer release or sandbox lanes in generated projects", () => {
    expect(resolveValidationStepCommand("release:prepare")).toBeUndefined();
    expect(resolveValidationStepCommand("validate:sandbox")).toBeUndefined();
  });

  test("projects hidden lint and format commands from generated workspace shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-runner-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      mkdirSync(join(dir, "scripts"), { recursive: true });
      mkdirSync(join(dir, ".agents/scripts/hooks"), { recursive: true });
      mkdirSync(join(dir, ".codex/hooks"), { recursive: true });
      mkdirSync(join(dir, ".claude/hooks"), { recursive: true });

      expect(resolveValidationStepCommand("lint:errors", dir)?.command).toEqual([
        ...localToolCommand("oxlint"),
        "-c",
        ".oxlintrc.jsonc",
        "--quiet",
        "--format=unix",
        "src/",
        "scripts/",
        ".agents/scripts/hooks/",
        ".codex/hooks/",
        ".claude/hooks/",
      ]);
      expect(resolveValidationStepCommand("format:check", dir)?.command).toContain(
        ".agents/scripts/hooks/**/*.{ts,tsx,js,jsx,mjs}",
      );
      expect(resolveValidationStepCommand("format:check", dir)?.command).toContain(
        ".codex/hooks/**/*.{ts,tsx,js,jsx,mjs}",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves hidden AI and frontend validation leaves without root package scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-runner-"));
    try {
      mkdirSync(join(dir, "scripts/agents"), { recursive: true });
      mkdirSync(join(dir, "apps/frontend"), { recursive: true });
      writeFileSync(join(dir, "scripts/agents/sync-agents-md.ts"), "");
      writeFileSync(join(dir, "apps/frontend/package.json"), "{}");

      expect(resolveValidationStepCommand("agents:check", dir)?.command).toEqual([
        process.execPath,
        "scripts/agents/sync-agents-md.ts",
        "--check",
      ]);
      expect(resolveValidationStepCommand("typecheck:frontend", dir)).toMatchObject({
        cwd: "apps/frontend",
        command: [process.execPath, "run", "--silent", "typecheck"],
      });
      expect(resolveValidationStepCommand("build:frontend", dir)).toMatchObject({
        cwd: "apps/frontend",
        command: [process.execPath, "run", "--silent", "build"],
      });
      expect(resolveValidationStepCommand("test:e2e", dir)).toMatchObject({
        cwd: "apps/frontend",
        command: [process.execPath, "run", "--no-install", "--silent", "playwright", "test"],
      });
      expect(resolveValidationStepCommand("lint:arch:frontend", dir)).toMatchObject({
        cwd: "apps/frontend",
        command: localToolCommand("dependency-cruiser", [
          "--config",
          ".dependency-cruiser.cjs",
          "--output-type",
          "err",
          "src",
          "e2e",
          "playwright.config.ts",
          "vite.config.ts",
        ]),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("hidden generated validation commands do not use package executors", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-runner-"));
    try {
      mkdirSync(join(dir, "apps/frontend"), { recursive: true });
      writeFileSync(join(dir, "apps/frontend/package.json"), "{}");

      const hiddenSteps = [
        "typecheck:frontend",
        "lint:frontend",
        "format:check:frontend",
        "lint:arch:frontend",
        "lint:css:frontend",
        "build:frontend",
        "test:e2e",
      ];

      for (const step of hiddenSteps) {
        const command = resolveValidationStepCommand(step, dir)?.command;
        expect(command, step).toBeDefined();
        expect(command?.join(" "), step).not.toMatch(/\b(?:bun\s+x|bunx|npx)\b/);
        expect(command, step).not.toContain("bunx");
        expect(command, step).not.toContain("npx");
        expect(command?.slice(0, 2), step).not.toEqual([process.execPath, "x"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("generated validation callers", () => {
  const root = join(import.meta.dir, "../../template-sources");

  test("pre-commit and pre-push do not call hidden base leaves as package scripts", () => {
    const callers = [
      "base/scripts/validation/typecheck-staged.ts",
      "base/scripts/validation/validate-push.ts",
    ];

    for (const caller of callers) {
      const content = readFileSync(join(root, caller), "utf8");
      const dynamicScriptInvocation = "bun run --silent $" + "{script}";
      expect(content).not.toContain('"bun", "run", "--silent", "typecheck"');
      expect(content).not.toContain('"bun", "run", "--silent", "typecheck:frontend"');
      expect(content).not.toContain(dynamicScriptInvocation);
    }
  });

  test("stop validation does not call hidden base leaves as package scripts", () => {
    const content = readFileSync(join(root, "base/scripts/validation/validate-on-stop.ts"), "utf8");

    expect(content).toContain('runGeneratedStep("typecheck", projectRoot, errors)');
    expect(content).toContain('runGeneratedStep("test", projectRoot, errors)');
    expect(content).not.toContain('"bun", "run", "--silent", "lint:errors"');
    expect(content).not.toContain('"bun", "run", "--silent", "format:check"');
    expect(content).not.toContain('"bun", "run", "--silent", "typecheck:frontend"');
    expect(content).not.toContain("validate:deep");
    expect(content).not.toContain("validate:sandbox");
    expect(content).not.toContain("release:prepare");
  });
});
