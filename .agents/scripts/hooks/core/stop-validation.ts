import type { CommandRunner, AgentFeedbackResult, AgentHookEvent } from "./contract.ts";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { defaultRunCommand, commandOutput, repoRoot, tail } from "./command-runner.ts";
import { forbiddenTouchedPaths, generatedPathMessage } from "./generated-files.ts";
import { clearTouchedPaths, readTouchedPaths } from "./touched-paths.ts";

type GitFingerprint = {
  readonly signature: string;
  readonly paths: readonly string[];
};

type GitFingerprintResult =
  | { readonly ok: true; readonly fingerprint: GitFingerprint }
  | { readonly ok: false; readonly reason: string };

export async function runStopValidation(
  input: AgentHookEvent,
  runner: CommandRunner = defaultRunCommand,
): Promise<AgentFeedbackResult> {
  if (input.stopHookActive === true) {
    return {};
  }

  const root = repoRoot(input.cwd);
  const forbidden = forbiddenTouchedPaths(await readTouchedPaths(input), root);
  if (forbidden.length > 0) {
    return { blockReason: generatedPathMessage(forbidden) };
  }

  const runId = randomUUID();
  const before = await captureGitFingerprint(root, runner);
  if (!before.ok) {
    return { blockReason: readOnlyProofUnavailableMessage(runId, before.reason) };
  }

  const result = await runner(["bun", "scripts/validation/validate-on-stop.ts"], {
    cwd: root,
    env: {
      KITSMITH_STOP_RUN_ID: runId,
      ...(input.sessionId === undefined ? {} : { KITSMITH_STOP_SESSION_ID: input.sessionId }),
    },
  });
  const after = await captureGitFingerprint(root, runner);
  if (!after.ok) {
    return { blockReason: readOnlyProofUnavailableMessage(runId, after.reason) };
  }

  if (before.fingerprint.signature !== after.fingerprint.signature) {
    return {
      blockReason: readOnlyViolationMessage(
        runId,
        changedGitPaths(before.fingerprint, after.fingerprint),
      ),
    };
  }

  if (result.code !== 0) {
    return {
      blockReason: `Stop validation failed:\n${tail(commandOutput(result), 80)}`,
    };
  }

  await clearTouchedPaths(input);
  return {};
}

async function captureGitFingerprint(
  root: string,
  runner: CommandRunner,
): Promise<GitFingerprintResult> {
  const insideWorkTree = await runner(["git", "rev-parse", "--is-inside-work-tree"], { cwd: root });
  if (insideWorkTree.code !== 0 || insideWorkTree.stdout.trim() !== "true") {
    return { ok: false, reason: "Git worktree is unavailable." };
  }

  const [status, worktreeDiff, indexDiff, untrackedFiles] = await Promise.all([
    runner(["git", "status", "--porcelain=v1", "-z", "-uall"], { cwd: root }),
    runner(["git", "diff", "--no-ext-diff", "--binary"], { cwd: root }),
    runner(["git", "diff", "--cached", "--no-ext-diff", "--binary"], { cwd: root }),
    runner(["git", "ls-files", "--others", "--exclude-standard", "-z"], { cwd: root }),
  ]);

  if (
    status.code !== 0 ||
    worktreeDiff.code !== 0 ||
    indexDiff.code !== 0 ||
    untrackedFiles.code !== 0
  ) {
    return { ok: false, reason: "Git status or diff fingerprint command failed." };
  }

  const untracked = await untrackedFileFingerprints(root, splitNul(untrackedFiles.stdout));
  return {
    ok: true,
    fingerprint: {
      signature: JSON.stringify({
        status: status.stdout,
        worktreeDiff: worktreeDiff.stdout,
        indexDiff: indexDiff.stdout,
        untracked,
      }),
      paths: parseStatusPaths(status.stdout),
    },
  };
}

async function untrackedFileFingerprints(
  root: string,
  files: readonly string[],
): Promise<readonly string[]> {
  const fingerprints = await Promise.all(
    files.map(async (file) => {
      const absolute = path.join(root, file);
      const fileStat = await lstat(absolute);
      if (fileStat.isSymbolicLink()) {
        return `${file}\0symlink\0${await readlink(absolute)}`;
      }
      const contentHash = fileStat.isFile()
        ? createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex")
        : "";
      return `${file}\0${fileStat.mode}\0${fileStat.size}\0${contentHash}`;
    }),
  );
  return fingerprints.toSorted();
}

function changedGitPaths(before: GitFingerprint, after: GitFingerprint): string[] {
  return [...new Set([...before.paths, ...after.paths])].toSorted();
}

function readOnlyViolationMessage(runId: string, changedPaths: readonly string[]): string {
  const paths = changedPaths.length > 0 ? changedPaths.join(", ") : "unknown Git-observable path";
  return [
    `Stop validation read-only violation (${runId}).`,
    `Validation mutated Git-observable repo state: ${paths}`,
    "Run the needed fix or sync outside the Stop hook, then retry.",
  ].join("\n");
}

function readOnlyProofUnavailableMessage(runId: string, reason: string): string {
  return [
    `Stop validation read-only proof unavailable (${runId}).`,
    reason,
    "Stop validation is blocked because it cannot prove the run preserved Git-observable repo state.",
  ].join("\n");
}

function parseStatusPaths(status: string): string[] {
  const paths: string[] = [];
  const entries = splitNul(status);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || entry.length < 4) {
      continue;
    }

    paths.push(entry.slice(3));
    const statusCode = entry.slice(0, 2);
    const previousPath = entries[index + 1];
    if ((statusCode.startsWith("R") || statusCode.startsWith("C")) && previousPath !== undefined) {
      index += 1;
      paths.push(previousPath);
    }
  }
  return [...new Set(paths)].toSorted();
}

function splitNul(value: string): string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}
