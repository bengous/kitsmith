import type { Workspace } from "../../../scripts/validation/shared/quality-workspace.ts";
import type {
  CommandResult,
  CommandRunner,
  AgentFeedbackResult,
  AgentHookEvent,
  UpdatedFileSnapshot,
} from "./contract.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  hasRoutableExtension,
  resolveGeneratedProjectWorkspace,
} from "../../../scripts/validation/shared/quality-workspace.ts";
import { commandOutput, defaultRunCommand, localTool, repoRoot, tail } from "./command-runner.ts";
import { forbiddenTouchedPaths, generatedPathMessage } from "./generated-files.ts";
import { extractTouchedPaths, readTouchedPaths, recordTouchedPaths } from "./touched-paths.ts";

export async function runPostEditQuality(
  input: AgentHookEvent,
  runner: CommandRunner = defaultRunCommand,
): Promise<AgentFeedbackResult> {
  const root = repoRoot(input.cwd);
  const extracted = extractTouchedPaths(input, root);
  await recordTouchedPaths(input, extracted);

  const paths = extracted.length > 0 ? extracted : await readTouchedPaths(input);
  const captureTarget = singleExistingTarget(root, paths);
  const beforeFormat = captureTarget === null ? null : await readTextFile(captureTarget);
  const forbidden = forbiddenTouchedPaths(paths, root);
  if (forbidden.length > 0) {
    return { blockReason: generatedPathMessage(forbidden) };
  }

  const existingPaths = paths.filter((filePath) => existsSync(path.join(root, filePath)));
  const buckets = bucketByWorkspace(existingPaths, root);
  const failures = (
    await Promise.all(
      [...buckets.values()].map(async (bucket) => runBucketQuality(root, bucket, runner)),
    )
  ).flat();

  const updatedFile = await changedSingleFileSnapshot(root, captureTarget, beforeFormat);
  if (failures.length > 0) {
    return {
      blockReason: `Post-edit quality gate failed:\n${failures.join("\n\n")}`,
      ...(updatedFile === undefined ? {} : { updatedFile }),
    };
  }
  return updatedFile === undefined ? {} : { updatedFile };
}

type BucketEntry = {
  readonly workspace: Workspace;
  readonly lintFixPaths: string[];
  readonly lintCheckPaths: string[];
  readonly formatPaths: string[];
};

function bucketByWorkspace(
  filePaths: readonly string[],
  root: string,
): Map<Workspace, BucketEntry> {
  const buckets = new Map<Workspace, BucketEntry>();
  for (const filePath of filePaths) {
    const workspace = resolveGeneratedProjectWorkspace(filePath, root);
    if (workspace === null) {
      continue;
    }
    let bucket = buckets.get(workspace);
    if (bucket === undefined) {
      bucket = { workspace, lintFixPaths: [], lintCheckPaths: [], formatPaths: [] };
      buckets.set(workspace, bucket);
    }
    if (hasRoutableExtension(filePath) && workspace.lint) {
      if (workspace.lintFix) {
        bucket.lintFixPaths.push(filePath);
      }
      bucket.lintCheckPaths.push(filePath);
    }
    if (hasRoutableExtension(filePath)) {
      bucket.formatPaths.push(filePath);
    }
  }
  return buckets;
}

async function runBucketQuality(
  root: string,
  bucket: BucketEntry,
  runner: CommandRunner,
): Promise<string[]> {
  const lintFixFailure = await runLintFix(root, bucket, runner);
  if (lintFixFailure !== null) {
    return [lintFixFailure];
  }

  const formatFailure = await runFormat(root, bucket, runner);
  if (formatFailure !== null) {
    return [formatFailure];
  }

  const lintFailure = await runLintCheck(root, bucket, runner);
  return lintFailure === null ? [] : [lintFailure];
}

async function runLintFix(
  root: string,
  bucket: BucketEntry,
  runner: CommandRunner,
): Promise<string | null> {
  if (bucket.lintFixPaths.length === 0) {
    return null;
  }

  const lintFix = await runner(
    [
      localTool(root, "oxlint"),
      ...bucket.workspace.oxlintArgs,
      "-c",
      bucket.workspace.oxlintConfig,
      "--fix",
      "--quiet",
      ...bucket.lintFixPaths,
    ],
    { cwd: root },
  );
  return lintFix.code === 0
    ? null
    : batchedCommandFailure("lint --fix", bucket.lintFixPaths, lintFix);
}

async function runFormat(
  root: string,
  bucket: BucketEntry,
  runner: CommandRunner,
): Promise<string | null> {
  if (bucket.formatPaths.length === 0) {
    return null;
  }

  const mode = bucket.workspace.formatMode === "write" ? "--write" : "--check";
  const format = await runner(
    [localTool(root, "oxfmt"), mode, "-c", bucket.workspace.oxfmtConfig, ...bucket.formatPaths],
    { cwd: root },
  );
  return format.code === 0 ? null : batchedCommandFailure("format", bucket.formatPaths, format);
}

async function runLintCheck(
  root: string,
  bucket: BucketEntry,
  runner: CommandRunner,
): Promise<string | null> {
  if (bucket.lintCheckPaths.length === 0) {
    return null;
  }

  const lint = await runner(
    [
      localTool(root, "oxlint"),
      ...bucket.workspace.oxlintArgs,
      "-c",
      bucket.workspace.oxlintConfig,
      "--quiet",
      "--format=unix",
      ...bucket.lintCheckPaths,
    ],
    { cwd: root },
  );
  return lint.code === 0 ? null : batchedCommandFailure("lint", bucket.lintCheckPaths, lint);
}

function batchedCommandFailure(
  label: string,
  paths: readonly string[],
  result: CommandResult,
): string {
  const summary =
    paths.length === 1
      ? paths[0]!
      : `${paths.length} files: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ", ..." : ""}`;
  return `${label}: ${summary}\n${tail(commandOutput(result), 40)}`;
}

function singleExistingTarget(root: string, paths: readonly string[]): string | null {
  if (paths.length !== 1) {
    return null;
  }

  const absolute = path.join(root, paths[0]!);
  return existsSync(absolute) ? absolute : null;
}

async function changedSingleFileSnapshot(
  root: string,
  filePath: string | null,
  before: string | null,
): Promise<UpdatedFileSnapshot | undefined> {
  if (filePath === null || before === null) {
    return undefined;
  }

  const after = await readTextFile(filePath);
  if (after === null || after === before) {
    return undefined;
  }

  return {
    path: path.relative(root, filePath).replaceAll(path.sep, "/"),
    before,
    after,
  };
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return null;
  }
}
