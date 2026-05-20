#!/usr/bin/env bun

/**
 * Mirrors Claude Code's native config into AGENTS.md for non-Claude AI agents
 * (Codex, OpenCode, etc.) that don't read .claude/rules/.
 *
 * ## Why this exists
 *
 * Claude Code loads CLAUDE.md + .claude/rules/ natively — it never reads AGENTS.md.
 * Other AI agents (Codex, OpenCode) don't understand .claude/rules/ but do walk
 * the directory tree loading AGENTS.md files. This script keeps them in sync so
 * all agents share the same source of truth.
 *
 * Keep generated AGENTS.md files model-useful: do not add visible generated-file
 * banners or maintenance warnings. Protection belongs in the manifest, drift
 * detection, validation, and hooks. Prefer narrow surface-specific rules; broad
 * rules that target unrelated directories create repeated context for agents.
 *
 * ## Mapping
 *
 *   Source (Claude Code native)      → Generated (for other agents)
 *   ──────────────────────────────────────────────────────────────
 *   CLAUDE.md                        → ./AGENTS.md
 *   .claude/rules/<rule>.md          → <dir>/AGENTS.md
 *
 * <dir> is the path prefix before the first glob wildcard in the rule's
 * `paths:` frontmatter (e.g., "src/cli" from "src/cli/\**\/\*.ts",
 * "scripts/setup" from "scripts/setup/\**").
 *
 * Layer files contain ONLY the matched rules — no root content duplication.
 * Non-Claude agents get root context from ./AGENTS.md and directory-specific
 * rules from <dir>/AGENTS.md as they navigate the directory tree.
 *
 * ## Rule file schema (.claude/rules/*.md)
 *
 *   ---
 *   paths:
 *     - "src/<layer>/**\/*.ts"      # glob patterns; target dir = prefix before first wildcard
 *     - "scripts/setup/**"          # → scripts/setup/AGENTS.md
 *   ---
 *
 *   ## Rule Title
 *
 *   Rule body (markdown). Everything after frontmatter is copied verbatim
 *   into the target layer's AGENTS.md.
 *
 * A single rule can target multiple layers (cross-cutting rules) by listing
 * multiple path patterns.
 *
 * ## Manifest schema (.agents/agents-md-manifest.json)
 *
 *   {
 *     "version": 2,
 *     "generated": ["AGENTS.md", "src/cli/AGENTS.md", ...],
 *     "outputs": {
 *       "AGENTS.md": {
 *         "kind": "root",
 *         "sourcePath": "CLAUDE.md",
 *         "checksum": "sha256-..."
 *       }
 *     },
 *     "sources": {
 *       "CLAUDE.md": { "checksum": "sha256-..." }
 *     }
 *   }
 *
 * Tracks all managed files. Used to detect stale files when rules are removed.
 *
 * ## Drift detection
 *
 * --check mode (default) performs three checks:
 *   1. Byte-exact match of each generated file against expected content
 *   2. Manifest paths match current rule → layer mapping
 *   3. Semantic check: each layer file contains all expected rule bodies
 *
 * The generated validation plan runs this script in --check mode automatically.
 *
 * ## Usage
 *
 *   bun scripts/agents/sync-agents-md.ts --write                 # generate/update files
 *   bun scripts/agents/sync-agents-md.ts --check                 # verify no drift (default)
 *   bun scripts/agents/sync-agents-md.ts --write --preserve-root # keep existing root AGENTS.md
 */

import { Glob } from "bun";
import { createHash } from "node:crypto";
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

const RULES_DIR = ".claude/rules";
const ROOT_MD = "CLAUDE.md";
const ROOT_AGENTS_MD = "AGENTS.md";
const MANIFEST_PATH = ".agents/agents-md-manifest.json";
const MANAGED_AGENTS_GLOBS = [
  ".agents/scripts/hooks/AGENTS.md",
  ".codex/hooks/AGENTS.md",
  ".claude/hooks/AGENTS.md",
  "apps/*/AGENTS.md",
  "src/*/AGENTS.md",
  "scripts/AGENTS.md",
  "scripts/*/AGENTS.md",
];

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export type Manifest = {
  readonly version: 2;
  readonly generated: string[];
  readonly outputs: Record<string, ManifestOutput>;
  readonly sources: Record<string, ManifestSource>;
};

export type ManifestOutput = {
  readonly kind: "root" | "layer";
  readonly checksum: string;
  readonly sourcePath?: string;
};

export type ManifestSource = {
  readonly checksum: string;
};

type Rule = {
  readonly name: string;
  readonly body: string;
};

type AgentsMdGenerationPlan = {
  readonly generated: ReadonlyMap<string, string>;
  readonly sourceContentByPath: ReadonlyMap<string, string>;
  readonly outputSourceByPath: ReadonlyMap<string, string>;
  readonly targetPaths: ReadonlySet<string>;
  readonly stale: readonly string[];
  readonly preserveExistingRoot: boolean;
};

type ManifestShape = {
  readonly version: unknown;
  readonly generated: unknown;
  readonly outputs: unknown;
  readonly sources: unknown;
};

function isManifest(value: unknown): value is Manifest {
  if (!isManifestShape(value) || value.version !== 2) {
    return false;
  }

  return (
    Array.isArray(value.generated) &&
    value.generated.every((entry) => typeof entry === "string") &&
    isManifestOutputRecord(value.outputs) &&
    isManifestSourceRecord(value.sources)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifestShape(value: unknown): value is ManifestShape {
  return (
    isRecord(value) &&
    "version" in value &&
    "generated" in value &&
    "outputs" in value &&
    "sources" in value
  );
}

function isManifestOutputRecord(value: unknown): value is Record<string, ManifestOutput> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (output) =>
        isRecord(output) &&
        (output["kind"] === "root" || output["kind"] === "layer") &&
        typeof output["checksum"] === "string" &&
        (output["sourcePath"] === undefined || typeof output["sourcePath"] === "string"),
    )
  );
}

function isManifestSourceRecord(value: unknown): value is Record<string, ManifestSource> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (source) => isRecord(source) && typeof source["checksum"] === "string",
    )
  );
}

function checksum(content: string): string {
  return `sha256-${createHash("sha256").update(normalizeNewlines(content)).digest("hex")}`;
}

function outputKind(path: string): ManifestOutput["kind"] {
  return path === ROOT_AGENTS_MD ? "root" : "layer";
}

export function generatedPathsFromManifest(manifest: Manifest): string[] {
  return [...new Set(manifest.generated.map(toPosixPath))].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

export function buildManifest(input: {
  readonly generated: ReadonlyMap<string, string>;
  readonly sourceContentByPath: ReadonlyMap<string, string>;
  readonly outputSourceByPath: ReadonlyMap<string, string>;
  readonly targetPaths: ReadonlySet<string>;
}): Manifest {
  const outputs: Record<string, ManifestOutput> = {};
  for (const path of [...input.targetPaths].toSorted((left, right) => left.localeCompare(right))) {
    const content = input.generated.get(path);
    if (content === undefined) {
      continue;
    }
    const sourcePath = input.outputSourceByPath.get(path);
    outputs[path] = {
      kind: outputKind(path),
      ...(sourcePath === undefined ? {} : { sourcePath }),
      checksum: checksum(content),
    };
  }

  const sources: Record<string, ManifestSource> = {};
  for (const [path, content] of [...input.sourceContentByPath].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    sources[path] = { checksum: checksum(content) };
  }

  return {
    version: 2,
    generated: [...input.targetPaths].toSorted((left, right) => left.localeCompare(right)),
    outputs,
    sources,
  };
}

export function normalizeNewlines(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

export function parsePaths(content: string): string[] {
  const normalized = normalizeNewlines(content);
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch === null) {
    return [];
  }

  const frontmatter = fmMatch[1] ?? "";
  const pathLines = frontmatter.match(/^\s*-\s*"([^"]+)"/gm);
  if (pathLines === null) {
    return [];
  }

  const dirs: string[] = [];
  for (const line of pathLines) {
    const quoted = line.match(/"([^"]+)"/);
    if (quoted === null) {
      continue;
    }
    const glob = toPosixPath(quoted[1] ?? "");
    const segments = glob.split("/");
    const dirSegments: string[] = [];
    for (const seg of segments) {
      if (seg.includes("*") || seg.includes("?") || seg.includes("{")) {
        break;
      }
      dirSegments.push(seg);
    }
    if (dirSegments.length >= 1) {
      dirs.push(dirSegments.join("/"));
    }
  }
  return [...new Set(dirs)];
}

export function stripFrontmatter(content: string): string {
  const normalized = normalizeNewlines(content);
  const match = normalized.match(/^---\n[\s\S]*?\n---\n?/);
  if (match === null) {
    return normalized;
  }
  return normalized.slice(match[0].length).replace(/^\n/, "");
}

/** Generate a layer AGENTS.md containing only matched rule bodies. */
export function generateLayerAgentsMd(rules: readonly Rule[]): string {
  if (rules.length === 0) {
    return "";
  }
  const parts: string[] = [];
  for (const rule of rules) {
    parts.push(rule.body.trimEnd(), "");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/**
 * Verify that each layer AGENTS.md contains exactly the expected rule blocks.
 */
export function verifyLayerContent(
  dirToRules: ReadonlyMap<string, readonly Rule[]>,
  agentsFiles: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];

  for (const [dir, rules] of dirToRules) {
    const path = `${dir}/AGENTS.md`;
    const content = agentsFiles.get(path);
    if (content === undefined) {
      continue;
    } // missing file already caught by byte check

    for (const rule of rules) {
      const ruleBody = rule.body.trimEnd();
      if (!content.includes(ruleBody)) {
        errors.push(`${path}: missing rule content from ${rule.name}`);
      }
    }
  }

  return errors;
}

export async function fileContainsCrlf(path: string): Promise<boolean> {
  return (await Bun.file(path).text()).includes("\r\n");
}

export async function pathIsSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

export function managedPathRegularFileError(path: string, isSymlink: boolean): string | null {
  return isSymlink ? `${path}: symlinks are not allowed for managed AGENTS.md files` : null;
}

async function ensureManagedPathIsRegularFile(path: string): Promise<string | null> {
  return managedPathRegularFileError(path, await pathIsSymlink(path));
}

async function writeLfFile(path: string, content: string): Promise<void> {
  const normalized = normalizeNewlines(content);
  const directory = dirname(path);
  if (directory !== ".") {
    await mkdir(directory, { recursive: true });
  }
  await Bun.write(path, normalized);
}

async function listManagedAgentsPaths(includeRoot: boolean): Promise<string[]> {
  const paths = includeRoot ? [ROOT_AGENTS_MD] : [];
  const managedPaths = await Promise.all(
    MANAGED_AGENTS_GLOBS.map(async (pattern) => {
      const glob = new Glob(pattern);
      return (await Array.fromAsync(glob.scan({ cwd: "." }))).map(toPosixPath);
    }),
  );
  paths.push(...managedPaths.flat());
  return [...new Set(paths)].toSorted();
}

async function readManifest(): Promise<Manifest> {
  const file = Bun.file(MANIFEST_PATH);
  if (!(await file.exists())) {
    return { version: 2, generated: [], outputs: {}, sources: {} };
  }

  const parsed = (await file.json()) as unknown;
  if (!isManifest(parsed)) {
    return { version: 2, generated: [], outputs: {}, sources: {} };
  }

  return parsed;
}

async function buildDirectoryMap(): Promise<{
  dirToRules: Map<string, Rule[]>;
  sourceContentByPath: Map<string, string>;
}> {
  const glob = new Glob("*.md");

  const ruleFiles = (await Array.fromAsync(glob.scan({ cwd: RULES_DIR })))
    .filter((filename) => filename !== "AGENTS.md")
    .toSorted((left, right) => left.localeCompare(right));
  const sourceContentByPath = new Map<string, string>();

  const rules = await Promise.all(
    ruleFiles.map(async (filename) => {
      const sourcePath = `${RULES_DIR}/${filename}`;
      const content = await Bun.file(sourcePath).text();
      sourceContentByPath.set(sourcePath, content);
      const dirs = parsePaths(content);
      const body = stripFrontmatter(content);
      return { filename, dirs, body };
    }),
  );

  const rows = rules.flatMap(({ filename, dirs, body }) =>
    dirs.map((dir) => ({ dir, rule: { name: filename, body } })),
  );
  const dirToRules = new Map<string, Rule[]>();
  for (const { dir, rule } of rows) {
    const bucket = dirToRules.get(dir);
    if (bucket === undefined) {
      dirToRules.set(dir, [rule]);
    } else {
      bucket.push(rule);
    }
  }

  return { dirToRules, sourceContentByPath };
}

function buildAgentsMdGenerationPlan(input: {
  readonly dirToRules: ReadonlyMap<string, readonly Rule[]>;
  readonly oldManifest: Manifest;
  readonly rootContent: string;
  readonly sourceContentByPath: ReadonlyMap<string, string>;
  readonly preserveExistingRoot: boolean;
}): AgentsMdGenerationPlan {
  const generated = new Map<string, string>();
  const sourceContentByPath = new Map<string, string>();
  const outputSourceByPath = new Map<string, string>();
  const targetPaths = new Set<string>(input.preserveExistingRoot ? [] : [ROOT_AGENTS_MD]);

  if (!input.preserveExistingRoot) {
    generated.set(ROOT_AGENTS_MD, input.rootContent);
    sourceContentByPath.set(ROOT_MD, input.rootContent);
    outputSourceByPath.set(ROOT_AGENTS_MD, ROOT_MD);
  }
  for (const [dir, rules] of input.dirToRules) {
    const path = `${dir}/AGENTS.md`;
    targetPaths.add(path);
    generated.set(path, generateLayerAgentsMd(rules));
    for (const rule of rules) {
      outputSourceByPath.set(path, `${RULES_DIR}/${rule.name}`);
    }
  }
  for (const [path, content] of input.sourceContentByPath) {
    if (path !== ROOT_MD || !input.preserveExistingRoot) {
      sourceContentByPath.set(path, content);
    }
  }

  return {
    generated,
    sourceContentByPath,
    outputSourceByPath,
    targetPaths,
    stale: generatedPathsFromManifest(input.oldManifest).filter((path) => !targetPaths.has(path)),
    preserveExistingRoot: input.preserveExistingRoot,
  };
}

function printErrors(errors: readonly string[]): void {
  for (const error of errors) {
    console.error(error);
  }
}

async function writeGeneratedFiles(generated: ReadonlyMap<string, string>): Promise<void> {
  await Promise.all(
    [...generated].map(async ([path, content]) => {
      await writeLfFile(path, content);
      console.log(`wrote ${path}`);
    }),
  );
}

async function removeStaleFiles(stale: readonly string[]): Promise<void> {
  await Promise.all(
    stale.map(async (path) => {
      if (await Bun.file(path).exists()) {
        await rm(path, { force: true });
        console.log(`removed stale ${path}`);
      }
    }),
  );
}

async function existingFileText(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  return file.text();
}

async function checkGeneratedFile(path: string, expected: string): Promise<string[]> {
  const errors: string[] = [];
  const actual = await existingFileText(path);
  if (actual === null) {
    return [`${path}: missing — run \`bun run agents:sync\``];
  }
  if (normalizeNewlines(actual) !== expected) {
    errors.push(`${path}: content drift — run \`bun run agents:sync\``);
  }
  if (await fileContainsCrlf(path)) {
    errors.push(`${path}: must use LF line endings`);
  }
  return errors;
}

async function checkStaleFiles(stale: readonly string[]): Promise<string[]> {
  const results = await Promise.all(
    stale.map(async (path) =>
      (await Bun.file(path).exists())
        ? `${path}: stale generated file — run \`bun run agents:sync\``
        : null,
    ),
  );
  return results.filter((error): error is string => error !== null);
}

async function checkManifest(expectedManifest: Manifest): Promise<string[]> {
  const manifestFile = Bun.file(MANIFEST_PATH);
  if (!(await manifestFile.exists())) {
    return [`${MANIFEST_PATH}: missing — run \`bun run agents:sync\``];
  }

  const parsedManifest = (await manifestFile.json()) as unknown;
  const currentManifest = isManifest(parsedManifest) ? parsedManifest : null;
  if (currentManifest === null) {
    return [`${MANIFEST_PATH}: invalid manifest shape — run \`bun run agents:sync\``];
  }

  const actualPaths = generatedPathsFromManifest(currentManifest);
  const errors: string[] = [];
  if (JSON.stringify(expectedManifest.generated) !== JSON.stringify(actualPaths)) {
    errors.push(`${MANIFEST_PATH}: manifest path drift — run \`bun run agents:sync\``);
  }
  if (JSON.stringify(expectedManifest) !== JSON.stringify(currentManifest)) {
    errors.push(`${MANIFEST_PATH}: manifest metadata drift — run \`bun run agents:sync\``);
  }
  return errors;
}

async function readLayerAgentsFiles(
  generated: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const files = await Promise.all(
    [...generated.keys()]
      .filter((path) => path !== ROOT_AGENTS_MD)
      .map(async (path) => {
        const text = await existingFileText(path);
        return text === null ? null : ([path, normalizeNewlines(text)] as const);
      }),
  );
  return new Map(files.filter((entry): entry is readonly [string, string] => entry !== null));
}

async function checkGeneratedState(
  generated: ReadonlyMap<string, string>,
  stale: readonly string[],
  expectedManifest: Manifest,
  dirToRules: ReadonlyMap<string, readonly Rule[]>,
): Promise<string[]> {
  const generatedErrors = (
    await Promise.all(
      [...generated].map(async ([path, expected]) => checkGeneratedFile(path, expected)),
    )
  ).flat();
  const agentsFiles = await readLayerAgentsFiles(generated);
  return [
    ...generatedErrors,
    ...(await checkStaleFiles(stale)),
    ...(await checkManifest(expectedManifest)),
    ...verifyLayerContent(dirToRules, agentsFiles),
  ];
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--write") ? "write" : "check";
  const preserveRoot = process.argv.includes("--preserve-root");

  const { dirToRules, sourceContentByPath } = await buildDirectoryMap();
  const rootContent = normalizeNewlines(await Bun.file(ROOT_MD).text());
  sourceContentByPath.set(ROOT_MD, rootContent);
  const oldManifest = await readManifest();
  const rootAgentsFile = Bun.file(ROOT_AGENTS_MD);
  const rootExists = await rootAgentsFile.exists();
  const rootWasManaged = oldManifest.generated.includes(ROOT_AGENTS_MD);
  const preserveExistingRoot = preserveRoot && rootExists && !rootWasManaged;
  const plan = buildAgentsMdGenerationPlan({
    dirToRules,
    oldManifest,
    rootContent,
    sourceContentByPath,
    preserveExistingRoot,
  });
  const manifest = buildManifest(plan);

  const errors: string[] = [];
  const managedAgentsPaths = await listManagedAgentsPaths(!plan.preserveExistingRoot);

  errors.push(
    ...(
      await Promise.all(
        managedAgentsPaths.map(async (path) => ensureManagedPathIsRegularFile(path)),
      )
    ).filter((error): error is string => error !== null),
  );

  if (await fileContainsCrlf(ROOT_MD)) {
    errors.push(`${ROOT_MD}: must use LF line endings`);
  }

  if (mode === "write") {
    if (errors.length > 0) {
      printErrors(errors);
      process.exit(1);
    }
    await writeGeneratedFiles(plan.generated);
    await removeStaleFiles(plan.stale);
    await Bun.write(MANIFEST_PATH, `${JSON.stringify(manifest, null, "\t")}\n`);
    console.log(`wrote ${MANIFEST_PATH}`);
  } else {
    errors.push(...(await checkGeneratedState(plan.generated, plan.stale, manifest, dirToRules)));
  }

  if (errors.length > 0) {
    printErrors(errors);
    console.error(
      `\nFound ${errors.length} AGENTS.md drift issue(s). Run \`bun run agents:sync\` to fix.`,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
