#!/usr/bin/env bun

import type { SandboxPaths } from "../testing/sandbox-runner.ts";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { parseJsonObject } from "../../src/core/json.ts";
import {
  buildSandboxCommand,
  createSandboxPaths,
  hostSecretAbsenceChecks,
  prepareSandboxRoot,
  requireLinuxBubblewrap,
  runSandboxCommand,
  sandboxTimeoutMs,
  shellQuote,
} from "../testing/sandbox-runner.ts";
import { tarballSmokeSandbox } from "../testing/tarball-smoke-sandbox.ts";

type CommandResult = {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type ReleasePrepareOptions = {
  readonly outDir?: string;
  readonly keepSandbox: boolean;
};

type NpmPackFile = {
  readonly path: string;
  readonly size?: number;
  readonly mode?: number;
};

type NpmPackResult = {
  readonly filename: string;
  readonly files: readonly NpmPackFile[];
};

export type ReleaseManifest = {
  readonly packageName: string;
  readonly version: string;
  readonly gitCommit: string;
  readonly timestamp: string;
  readonly tarballPath: string;
  readonly tarballSha512: string;
  readonly npmPackFileList: readonly string[];
  readonly packedPackageScripts: Readonly<Record<string, string>>;
  readonly packedDependencies: Readonly<Record<string, string>>;
  readonly packedDevDependencies: Readonly<Record<string, string>>;
  readonly forbiddenLifecycleScriptCheck: {
    readonly passed: boolean;
    readonly forbiddenScripts: readonly string[];
  };
  readonly tarballAllowlistCheck: {
    readonly passed: boolean;
    readonly unexpectedFiles: readonly string[];
    readonly sensitiveFiles: readonly string[];
  };
  readonly noNetworkInspection: {
    readonly passed: boolean;
  };
  readonly sandboxTarballSmoke: {
    readonly passed: boolean;
  };
};

const DEFAULT_RELEASE_PREPARE_TIMEOUT_MS = 900_000;
const SANDBOX_WORK = "/sandbox/work";
const SANDBOX_OUT = "/sandbox/out";

function run(command: readonly string[], cwd = process.cwd()): CommandResult {
  const proc = Bun.spawnSync([...command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    command,
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function commandLine(command: readonly string[]): string {
  return command.join(" ");
}

function runOrThrow(command: readonly string[], cwd = process.cwd()): CommandResult {
  console.log(`$ ${commandLine(command)}`);
  const result = run(command, cwd);
  if (result.stdout.trim().length > 0) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim().length > 0) {
    console.error(result.stderr.trim());
  }
  if (result.exitCode !== 0) {
    throw new Error(`${commandLine(command)} failed with exit code ${result.exitCode}`);
  }
  return result;
}

export function releasePrepareOptionsFromArgv(argv: readonly string[]): ReleasePrepareOptions {
  const outDirFlag = argv.indexOf("--out-dir");
  const outDir = outDirFlag === -1 ? undefined : argv[outDirFlag + 1];
  if (outDirFlag !== -1 && (outDir === undefined || outDir.startsWith("--"))) {
    throw new Error("Expected --out-dir to be followed by a directory path");
  }

  return {
    ...(outDir === undefined ? {} : { outDir }),
    keepSandbox: argv.includes("--keep-sandbox"),
  };
}

function releasePrepareTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return sandboxTimeoutMs(
    env,
    "KITSMITH_RELEASE_PREPARE_TIMEOUT_MS",
    DEFAULT_RELEASE_PREPARE_TIMEOUT_MS,
  );
}

function readPackageVersion(): string {
  const packageJson = readJsonObject("package.json");
  const version = packageJson["version"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json must define a non-empty version");
  }
  return version;
}

function readJsonObject(path: string): Record<string, unknown> {
  return parseJsonObject(readFileSync(path, "utf8"), path);
}

function assertCleanWorktree(): void {
  const status = runOrThrow(["git", "status", "--porcelain=v1"]);
  if (status.stdout.trim().length > 0) {
    throw new Error("Release prepare requires a clean worktree");
  }
}

function assertTagAvailable(tag: string): void {
  const localTag = run(["git", "tag", "--list", tag]);
  if (localTag.exitCode !== 0) {
    throw new Error(localTag.stderr || "Unable to inspect local tags");
  }
  if (localTag.stdout.trim().length > 0) {
    throw new Error(`Local tag already exists: ${tag}`);
  }

  const remoteTag = run(["git", "ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (remoteTag.exitCode !== 0) {
    throw new Error(remoteTag.stderr || "Unable to inspect remote tags");
  }
  if (remoteTag.stdout.trim().length > 0) {
    throw new Error(`Remote tag already exists: ${tag}`);
  }
}

function assertNpmVersionAvailable(version: string): void {
  const result = runOrThrow(["npm", "view", "kitsmith", "version", "dist-tags", "--json"]);
  const parsed = parseJsonObject(result.stdout, "npm view kitsmith");
  if (parsed["version"] === version) {
    throw new Error(`npm already reports kitsmith@${version}`);
  }
}

function latestTag(): string {
  const result = runOrThrow(["git", "describe", "--tags", "--abbrev=0"]);
  return result.stdout.trim();
}

function currentCommit(): string {
  return runOrThrow(["git", "rev-parse", "HEAD"]).stdout.trim();
}

async function prepareCleanWorkCopy(workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
  const archivePath = join(workDir, "../source.tar");
  runOrThrow(["git", "archive", "--format=tar", "--output", archivePath, "HEAD"]);
  runOrThrow(["tar", "-xf", archivePath, "-C", workDir]);
  await rm(archivePath, { force: true });
}

export function buildReleaseBuildPackSandboxCommand(
  paths: SandboxPaths,
  workDir: string,
  outDir: string,
): string[] {
  return buildSandboxCommand({
    paths,
    chdir: SANDBOX_WORK,
    innerScript: [
      "set -euo pipefail",
      ...hostSecretAbsenceChecks(paths.hostHome),
      "cd /sandbox/work",
      "bun install --ignore-scripts --frozen-lockfile",
      "bun run build",
      "npm pack --ignore-scripts --json --pack-destination /sandbox/out > /sandbox/out/npm-pack.json",
    ].join("\n"),
    mounts: [
      { kind: "read-write", source: workDir, target: SANDBOX_WORK },
      { kind: "read-write", source: outDir, target: SANDBOX_OUT },
    ],
    network: "enabled",
  });
}

export function buildReleaseInspectSandboxCommand(
  paths: SandboxPaths,
  workDir: string,
  outDir: string,
  packedFilename: string,
): string[] {
  const sandboxTarballPath = posix.join(SANDBOX_OUT, packedFilename);

  return buildSandboxCommand({
    paths,
    chdir: SANDBOX_WORK,
    innerScript: [
      "set -euo pipefail",
      ...hostSecretAbsenceChecks(paths.hostHome),
      `tarball=${shellQuote(sandboxTarballPath)}`,
      `test -f "$tarball" || { echo "Expected npm pack tarball missing: $tarball" >&2; exit 1; }`,
      `bun run ${shellQuote(
        posix.join(SANDBOX_WORK, "scripts/release/inspect-tarball.ts"),
      )} "$tarball" --no-network > /sandbox/out/tarball-inspection.json`,
    ].join("\n"),
    mounts: [
      { kind: "read-only", source: workDir, target: SANDBOX_WORK },
      { kind: "read-write", source: outDir, target: SANDBOX_OUT },
    ],
    network: "none",
  });
}

function parseNpmPackFile(value: unknown, label: string): NpmPackFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const path = "path" in value ? value.path : undefined;
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError(`${label}.path must be a non-empty string`);
  }

  return {
    path,
    ...("size" in value && typeof value.size === "number" ? { size: value.size } : {}),
    ...("mode" in value && typeof value.mode === "number" ? { mode: value.mode } : {}),
  };
}

export function parseNpmPackOutput(raw: string): NpmPackResult {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new TypeError("npm pack --json output must contain exactly one package entry");
  }

  const entries: readonly unknown[] = parsed;
  const entry = entries[0];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new TypeError("npm pack entry must be an object");
  }

  const filename = "filename" in entry ? entry.filename : undefined;
  if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
    throw new TypeError("npm pack entry must include a .tgz filename");
  }

  const files = "files" in entry ? entry.files : undefined;
  if (!Array.isArray(files)) {
    throw new TypeError("npm pack entry must include a files array");
  }

  return {
    filename,
    files: files.map((file, index) => parseNpmPackFile(file, `npm pack files[${index}]`)),
  };
}

function stringField(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function booleanField(source: Record<string, unknown>, key: string, label: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    throw new TypeError(`${label}.${key} must be a boolean`);
  }
  return value;
}

function objectField(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function stringRecordField(source: Record<string, unknown>, key: string): Record<string, string> {
  const value = objectField(source, key);
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function stringArrayField(source: Record<string, unknown>, key: string, label: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new TypeError(`${label}.${key} must be an array`);
  }

  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      throw new TypeError(`${label}.${key}[${index}] must be a string`);
    }
    strings.push(entry);
  }
  return strings;
}

export function createReleaseManifest(input: {
  readonly gitCommit: string;
  readonly timestamp: string;
  readonly tarballPath: string;
  readonly pack: NpmPackResult;
  readonly inspection: Record<string, unknown>;
}): ReleaseManifest {
  const allowlist = objectField(input.inspection, "allowlist");
  const lifecycleScripts = objectField(input.inspection, "lifecycleScripts");

  return {
    packageName: stringField(input.inspection, "packageName", "tarball inspection"),
    version: stringField(input.inspection, "version", "tarball inspection"),
    gitCommit: input.gitCommit,
    timestamp: input.timestamp,
    tarballPath: input.tarballPath,
    tarballSha512: stringField(input.inspection, "tarballSha512", "tarball inspection"),
    npmPackFileList: input.pack.files.map((file) => file.path).toSorted(),
    packedPackageScripts: stringRecordField(input.inspection, "scripts"),
    packedDependencies: stringRecordField(input.inspection, "dependencies"),
    packedDevDependencies: stringRecordField(input.inspection, "devDependencies"),
    forbiddenLifecycleScriptCheck: {
      passed: booleanField(lifecycleScripts, "passed", "lifecycleScripts"),
      forbiddenScripts: stringArrayField(lifecycleScripts, "forbiddenScripts", "lifecycleScripts"),
    },
    tarballAllowlistCheck: {
      passed: booleanField(allowlist, "passed", "allowlist"),
      unexpectedFiles: stringArrayField(allowlist, "unexpectedFiles", "allowlist"),
      sensitiveFiles: stringArrayField(allowlist, "sensitiveFiles", "allowlist"),
    },
    noNetworkInspection: { passed: true },
    sandboxTarballSmoke: { passed: true },
  };
}

async function resolveOutDir(options: ReleasePrepareOptions): Promise<string> {
  if (options.outDir !== undefined) {
    await mkdir(options.outDir, { recursive: true });
    return options.outDir;
  }
  return mkdtemp(join(tmpdir(), "kitsmith-release-"));
}

async function sandboxBuildPackInspect(options: {
  readonly sandboxRoot: string;
  readonly outDir: string;
}): Promise<{
  readonly tarballPath: string;
  readonly pack: NpmPackResult;
}> {
  const workDir = join(options.sandboxRoot, "work");
  await prepareCleanWorkCopy(workDir);
  await prepareSandboxRoot(options.sandboxRoot, ["out", "work"]);
  const paths = await createSandboxPaths(options.sandboxRoot);

  await runSandboxCommand(
    buildReleaseBuildPackSandboxCommand(paths, workDir, options.outDir),
    releasePrepareTimeoutMs(),
    "release build and pack sandbox",
  );

  const pack = parseNpmPackOutput(readFileSync(join(options.outDir, "npm-pack.json"), "utf8"));
  const tarballPath = join(options.outDir, pack.filename);

  await runSandboxCommand(
    buildReleaseInspectSandboxCommand(paths, workDir, options.outDir, pack.filename),
    releasePrepareTimeoutMs(),
    "release no-network tarball inspection",
  );

  return { tarballPath, pack };
}

async function main(
  options: ReleasePrepareOptions = releasePrepareOptionsFromArgv(process.argv),
): Promise<void> {
  requireLinuxBubblewrap("release prepare");

  const version = readPackageVersion();
  const tag = `v${version}`;
  const gitCommit = currentCommit();
  console.log(`Preparing kitsmith@${version}`);

  assertCleanWorktree();
  assertTagAvailable(tag);
  assertNpmVersionAvailable(version);

  runOrThrow(["cog", "check"]);
  const previousTag = latestTag();
  runOrThrow(["cog", "changelog", `${previousTag}..HEAD`]);
  const suggestedVersion = runOrThrow(["cog", "bump", "--auto", "--dry-run"]).stdout.trim();
  if (suggestedVersion !== tag) {
    throw new Error(`Expected cog dry-run bump ${tag}, got ${suggestedVersion}`);
  }

  runOrThrow(["bun", "run", "--silent", "validate"]);

  const outDir = await resolveOutDir(options);
  const sandboxRoot = await mkdtemp(join(tmpdir(), "kitsmith-release-sandbox-"));
  try {
    const { tarballPath, pack } = await sandboxBuildPackInspect({ sandboxRoot, outDir });
    await tarballSmokeSandbox({ tarballPath, keep: false });

    const inspection = parseJsonObject(
      readFileSync(join(outDir, "tarball-inspection.json"), "utf8"),
      "tarball-inspection.json",
    );
    const manifest = createReleaseManifest({
      gitCommit,
      timestamp: new Date().toISOString(),
      tarballPath,
      pack,
      inspection,
    });
    const manifestPath = join(outDir, "release-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const stableTarballPath = join(outDir, basename(tarballPath));
    if (stableTarballPath !== tarballPath) {
      await copyFile(tarballPath, stableTarballPath);
    }

    runOrThrow(["git", "diff", "--check"]);
    runOrThrow(["git", "status", "--short", "--branch"]);

    console.log(`Release prepare OK for kitsmith@${version}`);
    console.log(`Tarball: ${stableTarballPath}`);
    console.log(`Release manifest: ${manifestPath}`);
    console.log("Next step requires explicit human approval: npm publish, tag, push.");
  } finally {
    if (options.keepSandbox) {
      console.log(`Release prepare kept sandbox: ${sandboxRoot}`);
    } else {
      await rm(sandboxRoot, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
