import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { e2eContractScenarioOptionsFromArgv } from "./e2e-contract-scenario.ts";
import {
  buildE2eContractSandboxCommand,
  e2eContractOptionsFromArgv,
  e2eContractScenariosFromArgv,
  e2eContractTimeoutMs,
} from "./e2e-contract.ts";

const paths = {
  repoRoot: "/home/test-user/projects/kitsmith",
  bunBinary: "/home/test-user/.bun/bin/bun",
  hostSandboxRoot: "/tmp/kitsmith-e2e-contract",
  hostHome: "/home/test-user",
};

describe("e2eContractScenariosFromArgv", () => {
  test("returns the reduced real-e2e matrix by default", () => {
    expect(e2eContractScenariosFromArgv(["bun", "scripts/testing/e2e-contract.ts"])).toEqual([
      "none-ai",
      "none-effect",
      "tanstack-ai",
      "tanstack-ai-frontend",
      "tanstack-ai-effect",
    ]);
  });

  test("returns a single requested scenario", () => {
    expect(
      e2eContractScenariosFromArgv([
        "bun",
        "scripts/testing/e2e-contract.ts",
        "--scenario",
        "tanstack-plain",
      ]),
    ).toEqual(["tanstack-plain"]);
  });

  test("rejects unknown scenarios", () => {
    expect(() =>
      e2eContractScenariosFromArgv([
        "bun",
        "scripts/testing/e2e-contract.ts",
        "--scenario",
        "invalid",
      ]),
    ).toThrow("Expected --scenario to be one of");
  });

  test("keeps sandboxed e2e coverage explicit without install or release work", () => {
    const wrapperSource = readFileSync("scripts/testing/e2e-contract.ts", "utf8");
    const scenarioSource = readFileSync("scripts/testing/e2e-contract-scenario.ts", "utf8");

    expect(wrapperSource).toContain("buildE2eContractSandboxCommand");
    expect(wrapperSource).toContain('network: "enabled"');
    expect(wrapperSource).toContain("requireLinuxBubblewrap");
    expect(wrapperSource).toContain("mkdtemp");
    expect(scenarioSource).toContain("assertGeneratedProjectContract");
    for (const excluded of [
      "bun install",
      "test:safe-install",
      "test:smoke",
      "release:prepare",
      "npm",
      "publish",
    ]) {
      expect(wrapperSource).not.toContain(excluded);
      expect(scenarioSource).not.toContain(excluded);
    }
  });
});

describe("e2eContractOptionsFromArgv", () => {
  test("preserves requested scenario and keep mode", () => {
    expect(
      e2eContractOptionsFromArgv(
        ["bun", "scripts/testing/e2e-contract.ts", "--scenario", "none-ai", "--keep"],
        {},
      ),
    ).toEqual({
      scenarios: ["none-ai"],
      keep: true,
      jobs: 3,
    });
  });

  test("accepts an explicit scenario concurrency limit", () => {
    expect(
      e2eContractOptionsFromArgv(["bun", "scripts/testing/e2e-contract.ts", "--jobs", "2"]),
    ).toMatchObject({ jobs: 2 });
  });

  test("defaults to one scenario at a time in CI", () => {
    expect(
      e2eContractOptionsFromArgv(["bun", "scripts/testing/e2e-contract.ts"], { CI: "true" }),
    ).toMatchObject({ jobs: 1 });
  });
});

describe("e2eContractTimeoutMs", () => {
  test("uses a positive integer override", () => {
    expect(e2eContractTimeoutMs({ KITSMITH_E2E_CONTRACT_TIMEOUT_MS: "42" })).toBe(42);
    expect(e2eContractTimeoutMs({ KITSMITH_E2E_CONTRACT_TIMEOUT_MS: "0" })).toBe(600_000);
  });
});

describe("buildE2eContractSandboxCommand", () => {
  test("runs the scenario through the sandbox runner without inherited secrets", () => {
    const command = buildE2eContractSandboxCommand(paths, "tanstack-ai");
    const commandText = command.join(" ");

    expect(commandText).toContain("--ro-bind /home/test-user/projects/kitsmith");
    expect(commandText).toContain("env -i");
    expect(commandText).toContain("e2e-contract-scenario.ts");
    expect(commandText).toContain("--scenario 'tanstack-ai'");
    expect(commandText).toContain("--project-dir '/sandbox/project'");
    expect(commandText).not.toContain("NPM_TOKEN");
    expect(commandText).not.toContain("GITHUB_TOKEN");
    expect(commandText).not.toContain("SSH_AUTH_SOCK");
  });
});

describe("e2eContractScenarioOptionsFromArgv", () => {
  test("requires a known scenario and absolute project dir", () => {
    expect(
      e2eContractScenarioOptionsFromArgv([
        "bun",
        "scripts/testing/e2e-contract-scenario.ts",
        "--scenario",
        "tanstack-ai",
        "--project-dir",
        "/sandbox/project",
      ]),
    ).toEqual({
      scenario: "tanstack-ai",
      projectDir: "/sandbox/project",
    });

    expect(() =>
      e2eContractScenarioOptionsFromArgv([
        "bun",
        "scripts/testing/e2e-contract-scenario.ts",
        "--scenario",
        "invalid",
        "--project-dir",
        "/sandbox/project",
      ]),
    ).toThrow("Expected --scenario");
  });
});
