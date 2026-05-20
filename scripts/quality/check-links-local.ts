#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LINK_CHECK_EXTENSIONS = new Set([
  ".html",
  ".json",
  ".jsonc",
  ".md",
  ".toml",
  ".tpl",
  ".yaml",
  ".yml",
]);
const FALLBACK_SCAN_DIRS = ["docs", "config", "template-sources", "templates"] as const;
const GIT_LINK_CHECK_PATTERNS = [...LINK_CHECK_EXTENSIONS].map((extension) => `*${extension}`);
const LYCHEE_EXCLUDE_ARGS = [
  "--exclude-loopback",
  "--exclude",
  "^http://127\\.0\\.0\\.1(?::(?:\\d+|\\$\\{[^}]+\\}))?(?:/.*)?$",
] as const;
const LINK_PATTERN = /\]\([^)]+\)|\bhref\s*=/i;

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function extensionForPath(relativePath: string): string {
  return relativePath.includes(".") ? relativePath.slice(relativePath.lastIndexOf(".")) : "";
}

function isLinkCheckFile(filePath: string): boolean {
  return LINK_CHECK_EXTENSIONS.has(extensionForPath(normalizePath(filePath)));
}

function walkDocs(dir: string, root = dir): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDocs(fullPath, root));
      continue;
    }

    const relativePath = normalizePath(fullPath.slice(root.length + 1));
    if (isLinkCheckFile(relativePath)) {
      results.push(relativePath);
    }
  }
  return results;
}

function collectGitLinkCheckFiles(root: string): string[] | null {
  const result = Bun.spawnSync(
    ["git", "ls-files", "-co", "--exclude-standard", "--", ...GIT_LINK_CHECK_PATTERNS],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "ignore",
    },
  );

  if (result.exitCode !== 0) {
    return null;
  }

  return result.stdout
    .toString()
    .split("\n")
    .map((file) => normalizePath(file.trim()))
    .filter((file) => file.length > 0 && isLinkCheckFile(file));
}

function collectFallbackLinkCheckFiles(root: string): string[] {
  const files = new Set<string>();

  for (const rootFile of ["README.md", "CHANGELOG.md", "package.json"]) {
    if (existsSync(join(root, rootFile))) {
      files.add(rootFile);
    }
  }

  for (const dir of FALLBACK_SCAN_DIRS) {
    const path = join(root, dir);
    if (existsSync(path)) {
      for (const file of walkDocs(path, root)) {
        files.add(file);
      }
    }
  }

  return [...files];
}

export function collectLinkCheckFiles(root = process.cwd()): string[] {
  const files = new Set(collectGitLinkCheckFiles(root) ?? collectFallbackLinkCheckFiles(root));

  return [...files].toSorted((left, right) => left.localeCompare(right));
}

export function filesContainLinks(files: readonly string[], root = process.cwd()): boolean {
  return files.some((file) => LINK_PATTERN.test(readFileSync(join(root, file), "utf8")));
}

function main(): void {
  const files = collectLinkCheckFiles();

  if (files.length === 0) {
    console.error("Local link checking expected at least one Git-visible documentation file.");
    process.exit(1);
  }

  const versionCheck = Bun.spawnSync(["mise", "exec", "--", "lychee", "--version"], {
    stdout: "ignore",
    stderr: "ignore",
  });

  if (versionCheck.exitCode !== 0) {
    if (!filesContainLinks(files)) {
      console.log("No links found in Git-visible documentation files; skipping lychee.");
      process.exit(0);
    }
    console.error("Lychee is required for local checks. Run `mise install` from the repo root.");
    process.exit(1);
  }

  const lint = Bun.spawnSync(
    [
      "mise",
      "exec",
      "--",
      "lychee",
      "--offline",
      "--no-progress",
      "--format",
      "compact",
      "--root-dir",
      ".",
      ...LYCHEE_EXCLUDE_ARGS,
      ...files,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );

  process.exit(lint.exitCode);
}

if (import.meta.main) {
  main();
}
