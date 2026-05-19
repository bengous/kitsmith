#!/usr/bin/env bun

import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

type ParentToolingSyncMode = "replace-file" | "replace-tree" | "merge-lines";

export type ParentToolingSyncRule = {
  readonly name: string;
  readonly mode: ParentToolingSyncMode;
  readonly source: string;
  readonly target: string;
  readonly preserveExtra?: readonly string[];
};

export type ParentToolingChange =
  | {
      readonly kind: "write";
      readonly path: string;
      readonly content: string;
      readonly reason: string;
    }
  | {
      readonly kind: "remove";
      readonly path: string;
      readonly reason: string;
    };

export type ParentToolingPlan = {
  readonly changes: readonly ParentToolingChange[];
};

export const PARENT_TOOLING_SYNC_RULES = [
  {
    name: "shared agent hook runtime",
    mode: "replace-tree",
    source: "template-sources/ai/.agents/scripts/hooks",
    target: ".agents/scripts/hooks",
    preserveExtra: ["AGENTS.md"],
  },
  {
    name: "Codex hook wrappers",
    mode: "replace-tree",
    source: "template-sources/ai/.codex/hooks",
    target: ".codex/hooks",
    preserveExtra: ["AGENTS.md"],
  },
  {
    name: "Claude hook wrappers",
    mode: "replace-tree",
    source: "template-sources/ai/.claude/hooks",
    target: ".claude/hooks",
    preserveExtra: ["AGENTS.md"],
  },
  {
    name: "Codex hook config",
    mode: "replace-file",
    source: "template-sources/ai/.codex/config.toml",
    target: ".codex/config.toml",
  },
  {
    name: "Claude hook config",
    mode: "replace-file",
    source: "template-sources/ai/.claude/settings.json",
    target: ".claude/settings.json",
  },
  {
    name: "shared hook runtime Claude rule",
    mode: "replace-file",
    source: "template-sources/ai/.claude/rules/agent-hook-runtime.md",
    target: ".claude/rules/agent-hook-runtime.md",
  },
  {
    name: "native hook wrapper Claude rule",
    mode: "replace-file",
    source: "template-sources/ai/.claude/rules/native-hook-wrappers.md",
    target: ".claude/rules/native-hook-wrappers.md",
  },
  {
    name: "validation tooling Claude rule",
    mode: "replace-file",
    source: "template-sources/ai/.claude/rules/validation-tooling.md",
    target: ".claude/rules/validation-tooling.md",
  },
  {
    name: "generated quality scope policy",
    mode: "replace-file",
    source: "template-sources/base/scripts/validation/shared/quality-scope-policy.ts",
    target: "scripts/validation/shared/quality-scope-policy.ts",
  },
  {
    name: "generated quality scope policy test",
    mode: "replace-file",
    source: "template-sources/base/scripts/validation/shared/quality-scope-policy.test.ts",
    target: "scripts/validation/shared/quality-scope-policy.test.ts",
  },
  {
    name: "generated quality workspace adapter",
    mode: "replace-file",
    source: "template-sources/ai/scripts/validation/shared/quality-workspace.ts",
    target: "scripts/validation/shared/quality-workspace.ts",
  },
  {
    name: "generated quality repo path helper",
    mode: "replace-file",
    source: "template-sources/ai/scripts/validation/shared/repo-path.ts",
    target: "scripts/validation/shared/repo-path.ts",
  },
  {
    name: "strict parent OXLint config",
    mode: "replace-file",
    source: "template-sources/base/.oxlintrc.jsonc",
    target: ".oxlintrc.jsonc",
  },
  {
    name: "hook architecture dependency rules",
    mode: "replace-file",
    source: "template-sources/base/.dependency-cruiser.cjs",
    target: ".dependency-cruiser.cjs",
  },
  {
    name: "common generated-project ignores",
    mode: "merge-lines",
    source: "template-sources/base/.gitignore",
    target: ".gitignore",
  },
] as const satisfies readonly ParentToolingSyncRule[];

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeRelativePath(path: string): string {
  return toPosixPath(path).replace(/^\.\//, "");
}

function matchesRulePath(filePath: string, rulePath: string, mode: ParentToolingSyncMode): boolean {
  const normalizedFile = normalizeRelativePath(filePath);
  const normalizedRulePath = normalizeRelativePath(rulePath);
  if (mode === "replace-tree") {
    return (
      normalizedFile === normalizedRulePath || normalizedFile.startsWith(`${normalizedRulePath}/`)
    );
  }
  return normalizedFile === normalizedRulePath;
}

function isPreservedTargetExtra(filePath: string, rule: ParentToolingSyncRule): boolean {
  if (rule.mode !== "replace-tree") {
    return false;
  }

  const normalizedFile = normalizeRelativePath(filePath);
  const normalizedTarget = normalizeRelativePath(rule.target);
  const relativeTargetPath = normalizedFile.startsWith(`${normalizedTarget}/`)
    ? normalizedFile.slice(normalizedTarget.length + 1)
    : "";
  return (rule.preserveExtra ?? []).includes(relativeTargetPath);
}

export function isParentToolingSyncSourcePath(
  filePath: string,
  rules: readonly ParentToolingSyncRule[] = PARENT_TOOLING_SYNC_RULES,
): boolean {
  return rules.some((rule) => matchesRulePath(filePath, rule.source, rule.mode));
}

export function isParentToolingSyncTargetPath(
  filePath: string,
  rules: readonly ParentToolingSyncRule[] = PARENT_TOOLING_SYNC_RULES,
): boolean {
  return rules.some(
    (rule) =>
      matchesRulePath(filePath, rule.target, rule.mode) && !isPreservedTargetExtra(filePath, rule),
  );
}

export function isParentToolingSyncPath(
  filePath: string,
  rules: readonly ParentToolingSyncRule[] = PARENT_TOOLING_SYNC_RULES,
): boolean {
  return (
    isParentToolingSyncSourcePath(filePath, rules) || isParentToolingSyncTargetPath(filePath, rules)
  );
}

function normalizeNewlines(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

function ensureTrailingNewline(content: string): string {
  const normalized = normalizeNewlines(content);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function mergeLineSets(current: string, additions: string): string {
  const currentLines =
    normalizeNewlines(current).trimEnd().length === 0
      ? []
      : normalizeNewlines(current).trimEnd().split("\n");
  const seen = new Set(currentLines);

  for (const line of normalizeNewlines(additions).trimEnd().split("\n")) {
    if (line.length === 0 || seen.has(line)) {
      continue;
    }
    currentLines.push(line);
    seen.add(line);
  }

  return `${currentLines.join("\n")}\n`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertManagedPathIsNotSymlink(cwd: string, relativePath: string): Promise<void> {
  const parts = normalizeRelativePath(relativePath).split("/").filter(Boolean);
  let currentPath = cwd;
  let currentRelativePath = "";

  for (const part of parts) {
    currentPath = join(currentPath, part);
    currentRelativePath =
      currentRelativePath.length === 0 ? part : `${currentRelativePath}/${part}`;
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new Error(
          `${currentRelativePath}: symlinks are not allowed for parent tooling managed paths`,
        );
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function readText(cwd: string, relativePath: string): Promise<string | null> {
  await assertManagedPathIsNotSymlink(cwd, relativePath);
  try {
    return ensureTrailingNewline(await Bun.file(join(cwd, relativePath)).text());
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readRequiredText(cwd: string, relativePath: string): Promise<string> {
  const content = await readText(cwd, relativePath);
  if (content === null) {
    throw new Error(`${relativePath}: missing parent tooling source`);
  }
  return content;
}

async function listRelativeFiles(
  cwd: string,
  rootRelativePath: string,
  prefix = "",
): Promise<string[]> {
  const relativeDir = toPosixPath(
    prefix.length === 0 ? rootRelativePath : join(rootRelativePath, prefix),
  );
  await assertManagedPathIsNotSymlink(cwd, relativeDir);

  let entries;
  try {
    entries = await readdir(join(cwd, relativeDir), { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = toPosixPath(prefix.length === 0 ? entry.name : join(prefix, entry.name));
      const managedPath = toPosixPath(join(rootRelativePath, relativePath));
      if (entry.isSymbolicLink()) {
        throw new Error(
          `${managedPath}: symlinks are not allowed for parent tooling managed paths`,
        );
      }
      if (entry.isDirectory()) {
        return listRelativeFiles(cwd, rootRelativePath, relativePath);
      }
      return entry.isFile() ? [relativePath] : [];
    }),
  );
  return files.flat().toSorted((left, right) => left.localeCompare(right));
}

function writeChange(path: string, content: string, reason: string): ParentToolingChange {
  return { kind: "write", path, content, reason };
}

async function planReplaceFile(
  cwd: string,
  rule: ParentToolingSyncRule,
): Promise<ParentToolingChange[]> {
  const expected = await readRequiredText(cwd, rule.source);
  const actual = await readText(cwd, rule.target);
  return actual === expected ? [] : [writeChange(rule.target, expected, rule.name)];
}

async function planMergeLines(
  cwd: string,
  rule: ParentToolingSyncRule,
): Promise<ParentToolingChange[]> {
  const additions = await readRequiredText(cwd, rule.source);
  const current = await readText(cwd, rule.target);
  const expected = current === null ? additions : mergeLineSets(current, additions);
  return current === expected ? [] : [writeChange(rule.target, expected, rule.name)];
}

async function planReplaceTree(
  cwd: string,
  rule: ParentToolingSyncRule,
): Promise<ParentToolingChange[]> {
  const sourceRoot = join(cwd, rule.source);
  if (!(await pathExists(sourceRoot))) {
    throw new Error(`${rule.source}: missing parent tooling source`);
  }

  const sourceFiles = await listRelativeFiles(cwd, rule.source);
  const targetFiles = await listRelativeFiles(cwd, rule.target);
  const preserveExtra = new Set(rule.preserveExtra ?? []);
  const sourceFileSet = new Set(sourceFiles);
  const changes = (
    await Promise.all(
      sourceFiles.map(async (relativePath) => {
        const targetPath = toPosixPath(join(rule.target, relativePath));
        const expected = await readRequiredText(cwd, toPosixPath(join(rule.source, relativePath)));
        const actual = await readText(cwd, targetPath);
        return actual === expected ? null : writeChange(targetPath, expected, rule.name);
      }),
    )
  ).filter((change): change is ParentToolingChange => change !== null);

  for (const targetFile of targetFiles) {
    if (sourceFileSet.has(targetFile) || preserveExtra.has(targetFile)) {
      continue;
    }
    changes.push({
      kind: "remove",
      path: toPosixPath(join(rule.target, targetFile)),
      reason: `${rule.name} stale target`,
    });
  }

  return changes.toSorted((left, right) => left.path.localeCompare(right.path));
}

async function planRule(cwd: string, rule: ParentToolingSyncRule): Promise<ParentToolingChange[]> {
  switch (rule.mode) {
    case "replace-file":
      return planReplaceFile(cwd, rule);
    case "replace-tree":
      return planReplaceTree(cwd, rule);
    case "merge-lines":
      return planMergeLines(cwd, rule);
    default:
      rule.mode satisfies never;
      throw new Error("Unknown parent tooling sync mode");
  }
}

export async function planParentToolingSync(
  input: {
    readonly cwd?: string;
    readonly rules?: readonly ParentToolingSyncRule[];
  } = {},
): Promise<ParentToolingPlan> {
  const cwd = input.cwd ?? process.cwd();
  const rules = input.rules ?? PARENT_TOOLING_SYNC_RULES;
  const changes = (await Promise.all(rules.map(async (rule) => planRule(cwd, rule)))).flat();
  return { changes };
}

export function formatParentToolingDrift(changes: readonly ParentToolingChange[]): string[] {
  return changes.map((change) =>
    change.kind === "write"
      ? `${change.path}: drift from ${change.reason}; run \`bun run parent-tooling:sync\``
      : `${change.path}: stale managed file from ${change.reason}; run \`bun run parent-tooling:sync\``,
  );
}

export async function applyParentToolingSync(
  changes: readonly ParentToolingChange[],
  cwd = process.cwd(),
): Promise<void> {
  for (const change of changes) {
    const path = join(cwd, change.path);
    await assertManagedPathIsNotSymlink(cwd, change.path);
    if (change.kind === "write") {
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, change.content);
      console.log(`wrote ${change.path}`);
    } else {
      await rm(path, { force: true });
      console.log(`removed stale ${change.path}`);
    }
  }
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--write") ? "write" : "check";
  const plan = await planParentToolingSync();

  if (mode === "write") {
    await applyParentToolingSync(plan.changes);
    if (plan.changes.length === 0) {
      console.log("OK");
    }
    return;
  }

  if (plan.changes.length === 0) {
    console.log("OK");
    return;
  }

  for (const error of formatParentToolingDrift(plan.changes)) {
    console.error(error);
  }
  console.error(
    `\nFound ${plan.changes.length} parent tooling drift issue(s). Run \`bun run parent-tooling:sync\` to fix.`,
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
