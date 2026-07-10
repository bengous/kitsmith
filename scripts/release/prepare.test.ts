import { describe, expect, test } from "bun:test";
import {
  buildReleaseBuildPackSandboxCommand,
  buildReleaseInspectSandboxCommand,
  createReleaseManifest,
  parseNpmPackOutput,
  releasePrepareOptionsFromArgv,
} from "./prepare.ts";

const paths = {
  repoRoot: "/home/test-user/projects/kitsmith",
  bunBinary: "/home/test-user/.bun/bin/bun",
  hostSandboxRoot: "/tmp/kitsmith-release-sandbox",
  hostHome: "/home/test-user",
};

describe("releasePrepareOptionsFromArgv", () => {
  test("parses out dir and sandbox retention", () => {
    expect(
      releasePrepareOptionsFromArgv([
        "bun",
        "scripts/release/prepare.ts",
        "--out-dir",
        "/tmp/release",
        "--keep-sandbox",
      ]),
    ).toEqual({
      outDir: "/tmp/release",
      keepSandbox: true,
    });
  });

  test("rejects a missing out dir value", () => {
    expect(() =>
      releasePrepareOptionsFromArgv(["bun", "scripts/release/prepare.ts", "--out-dir"]),
    ).toThrow("Expected --out-dir");
  });
});

describe("buildReleaseBuildPackSandboxCommand", () => {
  test("builds and packs only inside the sandbox", () => {
    const command = buildReleaseBuildPackSandboxCommand(paths, "/tmp/work", "/tmp/out");
    const commandText = command.join(" ");

    expect(commandText).toContain("--bind /tmp/work /sandbox/work");
    expect(commandText).toContain("--bind /tmp/out /sandbox/out");
    expect(commandText).toContain("env -i");
    expect(commandText).toContain("bun install --ignore-scripts --frozen-lockfile");
    expect(commandText).toContain("npm pack --ignore-scripts --json");
    expect(commandText).not.toContain("npm publish --dry-run");
    expect(commandText).not.toContain("npx");
    expect(commandText).not.toContain("NPM_TOKEN");
  });
});

describe("buildReleaseInspectSandboxCommand", () => {
  test("runs tarball inspection with network disabled", () => {
    const command = buildReleaseInspectSandboxCommand(
      paths,
      "/tmp/work",
      "/tmp/out",
      "kitsmith-0.2.0.tgz",
    );
    const commandText = command.join(" ");

    expect(command).toContain("--unshare-net");
    expect(commandText).toContain("--ro-bind /tmp/work /sandbox/work");
    expect(commandText).toContain("--bind /tmp/out /sandbox/out");
    expect(commandText).toContain("inspect-tarball.ts");
    expect(commandText).toContain("--no-network");
  });

  test("inspects the exact npm pack artifact instead of selecting a stale tarball", () => {
    const command = buildReleaseInspectSandboxCommand(
      paths,
      "/tmp/work",
      "/tmp/out",
      "kitsmith-0.2.0.tgz",
    );
    const commandText = command.join(" ");

    expect(commandText).toContain("tarball='/sandbox/out/kitsmith-0.2.0.tgz'");
    expect(commandText).toContain('test -f "$tarball"');
    expect(commandText).toContain("Expected npm pack tarball missing");
    expect(commandText).not.toContain("find /sandbox/out");
    expect(commandText).not.toContain("kitsmith-*.tgz");
    expect(commandText).not.toContain("-print -quit");
  });
});

describe("parseNpmPackOutput", () => {
  test("parses the single packed artifact and file list", () => {
    expect(
      parseNpmPackOutput(
        JSON.stringify([
          {
            filename: "kitsmith-0.2.0.tgz",
            files: [{ path: "package.json", size: 1, mode: 420 }, { path: "dist/index.js" }],
          },
        ]),
      ),
    ).toEqual({
      filename: "kitsmith-0.2.0.tgz",
      files: [{ path: "package.json", size: 1, mode: 420 }, { path: "dist/index.js" }],
    });
  });
});

describe("createReleaseManifest", () => {
  test("records artifact evidence for the reviewed tarball", () => {
    const manifest = createReleaseManifest({
      gitCommit: "abc123",
      timestamp: "2026-05-13T00:00:00.000Z",
      tarballPath: "/tmp/release/kitsmith-0.2.0.tgz",
      pack: {
        filename: "kitsmith-0.2.0.tgz",
        files: [{ path: "dist/index.js" }, { path: "package.json" }],
      },
      inspection: {
        packageName: "kitsmith",
        version: "0.2.0",
        tarballSha512: "sha512",
        scripts: { prepack: "bun run build" },
        dependencies: { commander: "14.0.3" },
        devDependencies: { typescript: "6.0.3" },
        lifecycleScripts: { passed: true, forbiddenScripts: [] },
        allowlist: { passed: true, unexpectedFiles: [], sensitiveFiles: [] },
      },
    });

    expect(manifest.packageName).toBe("kitsmith");
    expect(manifest.version).toBe("0.2.0");
    expect(manifest.npmPackFileList).toEqual(["dist/index.js", "package.json"]);
    expect(manifest.packedPackageScripts["prepack"]).toBe("bun run build");
    expect(manifest.forbiddenLifecycleScriptCheck.passed).toBe(true);
    expect(manifest.tarballAllowlistCheck.passed).toBe(true);
    expect(manifest.noNetworkInspection.passed).toBe(true);
    expect(manifest.sandboxTarballSmoke.passed).toBe(true);
  });
});
