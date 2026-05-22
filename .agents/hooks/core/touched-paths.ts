import type { AgentHookEvent } from "./contract.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "./command-runner.ts";
import { requireSessionId } from "./session.ts";

export const TOUCHED_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function extractTouchedPaths(event: AgentHookEvent, root = repoRoot(event.cwd)): string[] {
  const cwd = path.resolve(event.cwd ?? root);

  return [...new Set(candidateTouchedPaths(event))]
    .map((filePath) => normalizeProjectPath(filePath, root, cwd))
    .filter((filePath): filePath is string => filePath !== null)
    .toSorted();
}

export function extractApplyPatchPaths(patch: string): string[] {
  const prefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

  const paths = new Set<string>();
  for (const rawLine of patch.split(/\r?\n/)) {
    for (const prefix of prefixes) {
      if (rawLine.startsWith(prefix)) {
        paths.add(rawLine.slice(prefix.length).trim());
      }
    }
  }

  return [...paths];
}

export function normalizeProjectPath(filePath: string, root: string, cwd = root): string | null {
  if (filePath.trim() === "") {
    return null;
  }

  const absolute = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
  const relative = path.relative(root, absolute);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return toPosix(relative);
}

export async function recordTouchedPaths(
  input: AgentHookEvent,
  paths: readonly string[],
): Promise<void> {
  const sessionId = requireSessionId(input);
  await pruneStaleTouchedStateForSession(input, sessionId);

  if (paths.length === 0) {
    return;
  }

  for (const filePath of touchedStatePaths(input, sessionId)) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const existing = await readTouchedPathFile(filePath);
    const next = [...new Set([...existing, ...paths])].toSorted();
    await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
}

export async function readTouchedPaths(input: AgentHookEvent): Promise<string[]> {
  const sessionId = requireSessionId(input);
  const paths = await Promise.all(touchedStatePaths(input, sessionId).map(readTouchedPathFile));
  return [...new Set(paths.flat())].toSorted();
}

async function readTouchedPathFile(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string").toSorted()
    : [];
}

export async function clearTouchedPaths(input: AgentHookEvent): Promise<void> {
  const sessionId = requireSessionId(input);
  await Promise.all(
    touchedStatePaths(input, sessionId).map(async (filePath) => rm(filePath, { force: true })),
  );
}

export async function pruneStaleTouchedState(
  input: AgentHookEvent,
  now = Date.now(),
): Promise<void> {
  await pruneStaleTouchedStateForSession(input, requireSessionId(input), now);
}

async function pruneStaleTouchedStateForSession(
  input: AgentHookEvent,
  sessionId: string,
  now = Date.now(),
): Promise<void> {
  const dir = stateDir(input);
  const currentSessionPrefix = `${stateIdentity(input, sessionId)}-`;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        return;
      }

      if (entry.name.startsWith(currentSessionPrefix)) {
        return;
      }

      await pruneStateFile(path.join(dir, entry.name), now);
    }),
  );
}

export function touchedStatePath(input: AgentHookEvent): string {
  const sessionId = requireSessionId(input);
  return statePath(input, sessionId, stateEventKey(input));
}

export function pendingTouchedStatePath(input: AgentHookEvent): string {
  const sessionId = requireSessionId(input);
  return statePath(input, sessionId, "pending");
}

function touchedStatePaths(input: AgentHookEvent, sessionId: string): string[] {
  return [
    ...new Set([
      statePath(input, sessionId, stateEventKey(input)),
      statePath(input, sessionId, "pending"),
    ]),
  ];
}

function stateDir(input: AgentHookEvent): string {
  const root = repoRoot(input.cwd);
  return path.join(tmpdir(), `${stateRootKey(root)}-agent-feedback`);
}

function statePath(input: AgentHookEvent, sessionId: string, eventKey: string): string {
  return path.join(
    stateDir(input),
    `${stateIdentity(input, sessionId)}-${stateSegment(eventKey)}.json`,
  );
}

function stateIdentity(input: AgentHookEvent, sessionId: string): string {
  return [input.agent, sessionId].map(stateSegment).join("-");
}

function stateEventKey(input: AgentHookEvent): string {
  return input.toolCallId ?? "pending";
}

function candidateTouchedPaths(event: AgentHookEvent): readonly string[] {
  return [
    ...(event.patchText === undefined ? [] : extractApplyPatchPaths(event.patchText)),
    ...event.touchedPathCandidates,
  ];
}

function stateRootName(root: string): string {
  const packageJsonPath = path.join(root, "package.json");
  if (!existsSync(packageJsonPath)) {
    return "kitsmith";
  }

  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
  if (isRecord(parsed) && typeof parsed["name"] === "string" && parsed["name"].length > 0) {
    return parsed["name"];
  }
  return "kitsmith";
}

function stateRootKey(root: string): string {
  const rootHash = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
  return `${sanitizeStateKey(stateRootName(root))}-${rootHash}`;
}

function sanitizeStateKey(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function stateSegment(value: string): string {
  const sanitized = sanitizeStateKey(value);
  if (sanitized.length <= 80) {
    return sanitized;
  }
  return `sha256-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function pruneStateFile(filePath: string, now: number): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }

  if (now - fileStat.mtimeMs > TOUCHED_STATE_TTL_MS) {
    await rm(filePath, { force: true });
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
