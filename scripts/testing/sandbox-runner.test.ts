import { describe, expect, test } from "bun:test";
import {
  buildSandboxCommand,
  buildSandboxEnv,
  hostHomeFromEnv,
  hostSecretAbsenceChecks,
  sandboxTimeoutMs,
} from "./sandbox-runner.ts";

const paths = {
  repoRoot: "/home/test-user/projects/kitsmith",
  bunBinary: "/home/test-user/.bun/bin/bun",
  hostSandboxRoot: "/tmp/kitsmith-sandbox-test",
  hostHome: "/home/test-user",
};

describe("sandboxTimeoutMs", () => {
  test("uses a positive integer override from the requested env key", () => {
    expect(
      sandboxTimeoutMs(
        { KITSMITH_SAFE_INSTALL_TIMEOUT_MS: "42" },
        "KITSMITH_SAFE_INSTALL_TIMEOUT_MS",
      ),
    ).toBe(42);
    expect(
      sandboxTimeoutMs(
        { KITSMITH_SAFE_INSTALL_TIMEOUT_MS: "0" },
        "KITSMITH_SAFE_INSTALL_TIMEOUT_MS",
      ),
    ).toBe(600_000);
    expect(
      sandboxTimeoutMs(
        { KITSMITH_SAFE_INSTALL_TIMEOUT_MS: "nope" },
        "KITSMITH_SAFE_INSTALL_TIMEOUT_MS",
      ),
    ).toBe(600_000);
  });
});

describe("buildSandboxEnv", () => {
  test("constructs a secretless package-manager environment", () => {
    const env = buildSandboxEnv(paths.bunBinary, { PLAYWRIGHT_PORT: "3100" });

    expect(env["HOME"]).toBe("/sandbox/home");
    expect(env["NPM_CONFIG_USERCONFIG"]).toBe("/sandbox/home/.npmrc");
    expect(env["BUN_INSTALL_CACHE_DIR"]).toBe("/sandbox/bun-cache");
    expect(env["PLAYWRIGHT_PORT"]).toBe("3100");
    expect(env["GITHUB_TOKEN"]).toBeUndefined();
    expect(env["NPM_TOKEN"]).toBeUndefined();
    expect(env["SSH_AUTH_SOCK"]).toBeUndefined();
  });

  test("rejects overrides for strict sandbox env keys", () => {
    expect(() => buildSandboxEnv(paths.bunBinary, { HOME: "/home/test-user" })).toThrow(
      "Sandbox env override is not allowed for HOME",
    );
  });
});

describe("hostHomeFromEnv", () => {
  test("requires an absolute host home path", () => {
    expect(hostHomeFromEnv({ HOME: "/home/test-user" })).toBe("/home/test-user");
    expect(() => hostHomeFromEnv({ HOME: "relative" })).toThrow("absolute HOME path");
  });
});

describe("hostSecretAbsenceChecks", () => {
  test("builds checks for host credential paths", () => {
    expect(hostSecretAbsenceChecks("/home/test-user")).toContain(
      "test ! -e '/home/test-user/.npmrc'",
    );
    expect(hostSecretAbsenceChecks("/home/test-user")).toContain(
      "test ! -d '/home/test-user/.ssh'",
    );
  });
});

describe("buildSandboxCommand", () => {
  test("runs under env -i without inherited host secrets", () => {
    const command = buildSandboxCommand({
      paths,
      chdir: paths.repoRoot,
      innerScript: "true",
      mounts: [{ kind: "read-only", source: paths.repoRoot, target: paths.repoRoot }],
      env: { PLAYWRIGHT_PORT: "3100" },
    });
    const commandText = command.join(" ");

    expect(command).toContain("bwrap");
    expect(command).toContain("-i");
    expect(commandText).toContain("PLAYWRIGHT_PORT=3100");
    expect(commandText).not.toContain("NPM_TOKEN");
    expect(commandText).not.toContain("GITHUB_TOKEN");
    expect(commandText).not.toContain("SSH_AUTH_SOCK");
    expect(commandText).not.toContain("HOME=/home/test-user");
    expect(commandText).toContain("--ro-bind /home/test-user/projects/kitsmith");
  });

  test("supports writable work mounts and no-network mode", () => {
    const command = buildSandboxCommand({
      paths,
      chdir: "/sandbox/work",
      innerScript: "true",
      mounts: [{ kind: "read-write", source: "/tmp/work", target: "/sandbox/work" }],
      network: "none",
    });
    const commandText = command.join(" ");

    expect(command).toContain("--unshare-net");
    expect(commandText).toContain("--bind /tmp/work /sandbox/work");
  });
});
