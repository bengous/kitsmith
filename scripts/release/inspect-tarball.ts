#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonObject } from "../../src/core/json.ts";

export type TarballAllowlistResult = {
  readonly passed: boolean;
  readonly unexpectedFiles: readonly string[];
  readonly sensitiveFiles: readonly string[];
};

export type PackedLifecycleScriptsResult = {
  readonly passed: boolean;
  readonly forbiddenScripts: readonly string[];
};

export type TarballInspection = {
  readonly packageName: string;
  readonly version: string;
  readonly tarballPath: string;
  readonly tarballSha512: string;
  readonly noNetwork: boolean;
  readonly files: readonly string[];
  readonly fileSha256: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly allowlist: TarballAllowlistResult;
  readonly lifecycleScripts: PackedLifecycleScriptsResult;
};

const ALLOWED_FILE_PATTERNS = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^dist\/index\.js$/,
  /^assets\/brand\/kitsmith-logo-full-640\.png$/,
  /^templates\/.+$/,
  /^template-sources\/.+$/,
] as const;

const DENIED_FILE_PATTERNS = [
  /^\.git(?:\/|$)/,
  /^\.env(?:\.|$)/,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)\.npmrc$/,
  /(?:^|\/)\.netrc$/,
  /(?:^|\/)\.ssh(?:\/|$)/,
  /(?:^|\/)\.aws(?:\/|$)/,
  /(?:^|\/)\.azure(?:\/|$)/,
  /(?:^|\/)\.config\/(?:gh|gcloud)(?:\/|$)/,
  /(?:^|\/)\.kube(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)bun\.lockb$/,
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)plans(?:\/|$)/,
  /(?:^|\/)\.codex\/(?:prompts|skills|agents|\.hooks)(?:\/|$)/,
  /(?:^|\/)\.codex\/hooks\.json$/,
  /(?:^|\/)\.omx(?:\/|$)/,
  /(?:^|\/)\.playwright-cli(?:\/|$)/,
] as const;

const FORBIDDEN_PACKED_LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "publish",
  "postpublish",
] as const;

function commandOutput(command: readonly string[]): string {
  const result = Bun.spawnSync([...command], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env["PATH"] ?? process.env["Path"] ?? "/usr/bin:/bin" },
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed with exit code ${result.exitCode}: ${result.stderr
        .toString()
        .trim()}`,
    );
  }

  return result.stdout.toString();
}

function assertTarballPath(path: string): void {
  if (!path.endsWith(".tgz")) {
    throw new Error(`Expected a .tgz tarball path, got ${path}`);
  }
}

function normalizeTarEntry(entry: string): string | undefined {
  if (entry.endsWith("/")) {
    return undefined;
  }

  const trimmed = entry;
  if (trimmed.length === 0 || trimmed === "package") {
    return undefined;
  }
  if (!trimmed.startsWith("package/")) {
    throw new Error(`Packed file must live under package/: ${entry}`);
  }

  const relativePath = trimmed.slice("package/".length);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.includes("..") ||
    relativePath.includes("\\")
  ) {
    throw new Error(`Unsafe packed file path: ${entry}`);
  }
  return relativePath;
}

function listTarballFiles(tarballPath: string): string[] {
  return commandOutput(["tar", "-tzf", tarballPath])
    .split(/\r?\n/)
    .filter((entry) => entry.trim().length > 0)
    .map(normalizeTarEntry)
    .filter((entry): entry is string => entry !== undefined)
    .toSorted((left, right) => left.localeCompare(right));
}

function extractTarball(tarballPath: string, outputDir: string): void {
  commandOutput(["tar", "-xzf", tarballPath, "-C", outputDir]);
}

function recordField(source: unknown): Readonly<Record<string, string>> {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return {};
  }

  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") {
      record[key] = value;
    }
  }
  return record;
}

function hashFileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashFileSha512(path: string): string {
  return createHash("sha512").update(readFileSync(path)).digest("base64");
}

function inspectAllowlist(files: readonly string[]): TarballAllowlistResult {
  const unexpectedFiles = files.filter(
    (file) => !ALLOWED_FILE_PATTERNS.some((pattern) => pattern.test(file)),
  );
  const sensitiveFiles = files.filter((file) =>
    DENIED_FILE_PATTERNS.some((pattern) => pattern.test(file)),
  );

  return {
    passed: unexpectedFiles.length === 0 && sensitiveFiles.length === 0,
    unexpectedFiles,
    sensitiveFiles,
  };
}

function inspectPackedLifecycleScripts(
  scripts: Readonly<Record<string, string>>,
): PackedLifecycleScriptsResult {
  const forbiddenScripts = FORBIDDEN_PACKED_LIFECYCLE_SCRIPTS.filter(
    (script) => scripts[script] !== undefined,
  );

  return {
    passed: forbiddenScripts.length === 0,
    forbiddenScripts,
  };
}

export function assertNoDefaultNetworkRoute(routeTable: string): void {
  const defaultRoute = routeTable
    .split(/\r?\n/)
    .slice(1)
    .some((line) => line.trim().split(/\s+/)[1] === "00000000");

  if (defaultRoute) {
    throw new Error("Expected no-network tarball inspection to run without a default route");
  }
}

function assertNoNetworkNamespace(): void {
  if (process.platform !== "linux") {
    throw new Error("No-network tarball inspection requires Linux network namespace checks");
  }
  assertNoDefaultNetworkRoute(readFileSync("/proc/net/route", "utf8"));
}

export async function inspectTarball(
  tarballPath: string,
  options: { readonly noNetwork?: boolean } = {},
): Promise<TarballInspection> {
  assertTarballPath(tarballPath);
  await stat(tarballPath);
  if (options.noNetwork) {
    assertNoNetworkNamespace();
  }

  const files = listTarballFiles(tarballPath);
  const allowlist = inspectAllowlist(files);
  if (!allowlist.passed) {
    throw new Error(
      [
        "Packed tarball contains files outside the release allowlist.",
        allowlist.unexpectedFiles.length > 0
          ? `Unexpected files: ${allowlist.unexpectedFiles.join(", ")}`
          : undefined,
        allowlist.sensitiveFiles.length > 0
          ? `Sensitive files: ${allowlist.sensitiveFiles.join(", ")}`
          : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    );
  }

  const extractDir = mkdtempSync(join(tmpdir(), "kitsmith-inspect-tarball-"));
  try {
    extractTarball(tarballPath, extractDir);
    const packageJson = parseJsonObject(
      readFileSync(join(extractDir, "package/package.json"), "utf8"),
      "packed package.json",
    );
    const name = packageJson["name"];
    const version = packageJson["version"];
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Packed package.json must define a package name");
    }
    if (typeof version !== "string" || version.length === 0) {
      throw new Error("Packed package.json must define a version");
    }
    const scripts = recordField(packageJson["scripts"]);
    const lifecycleScripts = inspectPackedLifecycleScripts(scripts);
    if (!lifecycleScripts.passed) {
      throw new Error(
        `Packed package.json defines forbidden lifecycle scripts: ${lifecycleScripts.forbiddenScripts.join(
          ", ",
        )}`,
      );
    }

    return {
      packageName: name,
      version,
      tarballPath,
      tarballSha512: hashFileSha512(tarballPath),
      noNetwork: options.noNetwork === true,
      files,
      fileSha256: Object.fromEntries(
        files.map((file) => [file, hashFileSha256(join(extractDir, "package", file))]),
      ),
      scripts,
      dependencies: recordField(packageJson["dependencies"]),
      devDependencies: recordField(packageJson["devDependencies"]),
      allowlist,
      lifecycleScripts,
    };
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const tarballPath = process.argv[2];
  if (tarballPath === undefined) {
    console.error("Usage: bun scripts/release/inspect-tarball.ts <tarball.tgz> [--no-network]");
    process.exit(1);
  }

  try {
    const inspection = await inspectTarball(tarballPath, {
      noNetwork: process.argv.includes("--no-network"),
    });
    console.log(JSON.stringify(inspection, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
