import { describe, expect, test } from "bun:test";
import {
  buildSafeInstallSandboxCommand,
  safeInstallOptionsFromArgv,
  safeInstallTimeoutMs,
} from "./safe-install-smoke.ts";
import { SCAFFOLD_SCENARIO_CONFIG } from "./scenarios.ts";

function tanStackAiSafeInstallCommandText(): string {
  return buildSafeInstallSandboxCommand(
    {
      repoRoot: "/home/b3ngous/projects/kitsmith",
      bunBinary: "/home/b3ngous/.bun/bin/bun",
      hostSandboxRoot: "/tmp/kitsmith-safe-install-test",
      hostHome: "/home/b3ngous",
    },
    "tanstack-ai",
    SCAFFOLD_SCENARIO_CONFIG["tanstack-ai"],
  ).join(" ");
}

describe("safeInstallOptionsFromArgv", () => {
  test("defaults to the TanStack AI scenario", () => {
    expect(safeInstallOptionsFromArgv(["bun", "scripts/testing/safe-install-smoke.ts"])).toEqual({
      scenario: "tanstack-ai",
      keep: false,
    });
  });

  test("parses scenario and keep flags", () => {
    expect(
      safeInstallOptionsFromArgv([
        "bun",
        "scripts/testing/safe-install-smoke.ts",
        "--scenario",
        "tanstack-ai-effect",
        "--keep",
      ]),
    ).toEqual({ scenario: "tanstack-ai-effect", keep: true });
  });
});

describe("safeInstallTimeoutMs", () => {
  test("uses a bounded positive integer override", () => {
    expect(safeInstallTimeoutMs({ KITSMITH_SAFE_INSTALL_TIMEOUT_MS: "42" })).toBe(42);
    expect(safeInstallTimeoutMs({ KITSMITH_SAFE_INSTALL_TIMEOUT_MS: "0" })).toBe(600_000);
    expect(safeInstallTimeoutMs({ KITSMITH_SAFE_INSTALL_TIMEOUT_MS: "nope" })).toBe(600_000);
  });
});

describe("buildSafeInstallSandboxCommand", () => {
  test("runs the install smoke under env -i with only the repo and Bun binary mounted", () => {
    const commandText = tanStackAiSafeInstallCommandText();

    expect(commandText).toContain("bwrap");
    expect(commandText).toContain(" -i ");
    expect(commandText).toContain("/home/b3ngous/projects/kitsmith");
    expect(commandText).toContain("/home/b3ngous/.bun/bin/bun");
    expect(commandText).toContain("--git-init true");
    expect(commandText).not.toContain("--git-init false");
    expect(commandText).toContain("bun run check");
    expect(commandText).not.toContain("bun run typecheck");
    expect(commandText).toContain("test ! -e '/home/b3ngous/.npmrc'");
    expect(commandText).not.toContain("--ro-bind /home/b3ngous/.npmrc");
    expect(commandText).not.toContain("--ro-bind /home/b3ngous/.ssh");
  });

  test("runs the supply-chain probe inside the sandbox after installing", () => {
    const commandText = tanStackAiSafeInstallCommandText().replaceAll("\\", "/");
    const installIndex = commandText.indexOf("--install true");
    const probeIndex = commandText.indexOf("scripts/testing/supply-chain-probe.ts");

    expect(installIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(installIndex);
    expect(commandText).toContain("/sandbox/project");
  });
});
