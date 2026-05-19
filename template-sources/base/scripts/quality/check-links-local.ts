#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOC_EXTENSIONS = new Set([".md", ".html"]);
const LINK_PATTERN = /\]\([^)]+\)|\bhref\s*=/i;

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
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
    const extension = relativePath.includes(".")
      ? relativePath.slice(relativePath.lastIndexOf("."))
      : "";
    if (DOC_EXTENSIONS.has(extension)) {
      results.push(relativePath);
    }
  }
  return results;
}

export function collectLinkCheckFiles(root = process.cwd()): string[] {
  const files = new Set<string>();

  const readmePath = join(root, "README.md");
  if (existsSync(readmePath)) {
    files.add("README.md");
  }

  const docsPath = join(root, "docs");
  if (existsSync(docsPath)) {
    for (const file of walkDocs(docsPath, root)) {
      files.add(file);
    }
  }

  return [...files].toSorted((left, right) => left.localeCompare(right));
}

export function filesContainLinks(files: readonly string[], root = process.cwd()): boolean {
  return files.some((file) => LINK_PATTERN.test(readFileSync(join(root, file), "utf8")));
}

function main(): void {
  const files = collectLinkCheckFiles();

  if (files.length === 0) {
    console.log("No README.md or docs/**/*.{md,html} found; skipping local link check.");
    process.exit(0);
  }

  const versionCheck = Bun.spawnSync(["mise", "exec", "--", "lychee", "--version"], {
    stdout: "ignore",
    stderr: "ignore",
  });

  if (versionCheck.exitCode !== 0) {
    if (!filesContainLinks(files)) {
      console.log("No links found in README/docs; skipping lychee.");
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
      ...files,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );

  process.exit(lint.exitCode);
}

if (import.meta.main) {
  main();
}
