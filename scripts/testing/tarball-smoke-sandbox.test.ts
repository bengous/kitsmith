import { describe, expect, test } from "bun:test";
import {
  buildTarballInspectionSandboxCommand,
  buildTarballSmokeSandboxCommand,
  tarballSmokeOptionsFromArgv,
  tarballSmokeTimeoutMs,
} from "./tarball-smoke-sandbox.ts";

const paths = {
  repoRoot: "/home/test-user/projects/kitsmith",
  bunBinary: "/home/test-user/.bun/bin/bun",
  hostSandboxRoot: "/tmp/kitsmith-tarball-smoke",
  hostHome: "/home/test-user",
};

describe("tarballSmokeOptionsFromArgv", () => {
  test("requires a tarball path", () => {
    expect(() => tarballSmokeOptionsFromArgv(["bun", "tarball-smoke-sandbox.ts"])).toThrow(
      "Usage:",
    );
  });

  test("parses tarball path and keep flag", () => {
    expect(
      tarballSmokeOptionsFromArgv([
        "bun",
        "tarball-smoke-sandbox.ts",
        "/tmp/kitsmith.tgz",
        "--keep",
      ]),
    ).toEqual({
      tarballPath: "/tmp/kitsmith.tgz",
      keep: true,
    });
  });
});

describe("tarballSmokeTimeoutMs", () => {
  test("uses a positive integer override", () => {
    expect(tarballSmokeTimeoutMs({ KITSMITH_TARBALL_SMOKE_TIMEOUT_MS: "42" })).toBe(42);
    expect(tarballSmokeTimeoutMs({ KITSMITH_TARBALL_SMOKE_TIMEOUT_MS: "0" })).toBe(600_000);
  });
});

describe("buildTarballInspectionSandboxCommand", () => {
  test("runs inspection with no network and a read-only tarball mount", () => {
    const command = buildTarballInspectionSandboxCommand(paths, "/tmp/kitsmith.tgz");
    const commandText = command.join(" ");

    expect(command).toContain("--unshare-net");
    expect(commandText).toContain("--ro-bind /tmp/kitsmith.tgz /sandbox/tarball/kitsmith.tgz");
    expect(commandText).toContain("inspect-tarball.ts");
    expect(commandText).toContain("--no-network");
    expect(commandText).not.toContain("NPM_TOKEN");
  });
});

describe("buildTarballSmokeSandboxCommand", () => {
  test("installs the exact mounted tarball without lifecycle scripts", () => {
    const command = buildTarballSmokeSandboxCommand(paths, "/tmp/kitsmith.tgz", "0.2.0");
    const commandText = command.join(" ");

    expect(command).not.toContain("--unshare-net");
    expect(commandText).toContain("--ro-bind /tmp/kitsmith.tgz /sandbox/tarball/kitsmith.tgz");
    expect(commandText).toContain("bun install --ignore-scripts");
    expect(commandText).toContain("/sandbox/project/node_modules/.bin/kitsmith --version");
    expect(commandText).toContain("--install false");
    expect(commandText).not.toContain("npx");
    expect(commandText).not.toContain("bunx");
    expect(commandText).not.toContain("bun x");
    expect(commandText).not.toContain("NPM_TOKEN");
  });
});
