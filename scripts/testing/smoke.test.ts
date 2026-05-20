import { describe, expect, test } from "bun:test";
import { SCAFFOLD_SCENARIO_CONFIG } from "./scenarios.ts";
import {
  buildSmokeSandboxCommand,
  smokeOptionsFromArgv,
  smokeScenariosFromArgv,
  smokeTimeoutMs,
} from "./smoke.ts";

const paths = {
  repoRoot: "/home/b3ngous/projects/kitsmith",
  bunBinary: "/home/b3ngous/.bun/bin/bun",
  hostSandboxRoot: "/tmp/kitsmith-smoke",
  hostHome: "/home/b3ngous",
};

describe("smokeScenariosFromArgv", () => {
  test("returns the full matrix by default", () => {
    expect(smokeScenariosFromArgv(["bun", "scripts/testing/smoke.ts"])).toEqual([
      "none-plain",
      "none-ai",
      "none-effect",
      "none-ai-effect",
      "tanstack-plain",
      "tanstack-ai",
      "tanstack-ai-frontend",
      "tanstack-effect",
      "tanstack-ai-effect",
    ]);
  });

  test("returns a single requested scenario", () => {
    expect(
      smokeScenariosFromArgv(["bun", "scripts/testing/smoke.ts", "--scenario", "tanstack-ai"]),
    ).toEqual(["tanstack-ai"]);
  });

  test("rejects unknown scenarios", () => {
    expect(() =>
      smokeScenariosFromArgv(["bun", "scripts/testing/smoke.ts", "--scenario", "nope"]),
    ).toThrow("Expected --scenario to be one of");
  });
});

describe("smokeOptionsFromArgv", () => {
  test("preserves requested scenario and keep mode", () => {
    expect(
      smokeOptionsFromArgv(
        ["bun", "scripts/testing/smoke.ts", "--scenario", "none-ai", "--keep"],
        {},
      ),
    ).toEqual({
      scenarios: ["none-ai"],
      keep: true,
      jobs: 3,
    });
  });

  test("accepts an explicit scenario concurrency limit", () => {
    expect(smokeOptionsFromArgv(["bun", "scripts/testing/smoke.ts", "--jobs", "2"]).jobs).toBe(2);
  });

  test("defaults to one scenario at a time in CI", () => {
    expect(smokeOptionsFromArgv(["bun", "scripts/testing/smoke.ts"], { CI: "true" }).jobs).toBe(1);
  });
});

describe("smokeTimeoutMs", () => {
  test("uses a positive integer override", () => {
    expect(smokeTimeoutMs({ KITSMITH_SMOKE_TIMEOUT_MS: "42" })).toBe(42);
    expect(smokeTimeoutMs({ KITSMITH_SMOKE_TIMEOUT_MS: "0" })).toBe(900_000);
  });
});

describe("buildSmokeSandboxCommand", () => {
  test("runs install, probe, and validation inside the sandbox", () => {
    const command = buildSmokeSandboxCommand(
      paths,
      "tanstack-ai",
      SCAFFOLD_SCENARIO_CONFIG["tanstack-ai"],
    );
    const commandText = command.join(" ");

    expect(commandText).toContain("--ro-bind /home/b3ngous/projects/kitsmith");
    expect(commandText).toContain("env -i");
    expect(commandText).toContain("bun install");
    expect(commandText).toContain("supply-chain-probe.ts");
    expect(commandText).not.toContain("playwright install");
    expect(commandText).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium");
    expect(commandText).toContain("PLAYWRIGHT_PORT='3105' bun run validate");
    expect(commandText).not.toContain("NPM_TOKEN");
    expect(commandText).not.toContain("GITHUB_TOKEN");
    expect(commandText).not.toContain("SSH_AUTH_SOCK");
  });
});
