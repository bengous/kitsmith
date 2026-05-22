import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TOUCHED_STATE_TTL_MS,
  clearTouchedPaths,
  extractApplyPatchPaths,
  extractTouchedPaths,
  pendingTouchedStatePath,
  pruneStaleTouchedState,
  readTouchedPaths,
  recordTouchedPaths,
} from "./touched-paths.ts";

async function makeTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-hooks-"));
  await seedFile(root, ".agents/agents-md-manifest.json", "{}\n");
  await seedFile(root, "package.json", '{ "name": "generated app" }\n');
  await seedFile(root, "bunfig.toml", "\n");
  await seedFile(root, "src/index.ts", "export const main = true;\n");
  return root;
}

async function seedFile(root: string, relPath: string, content: string): Promise<void> {
  const absolute = path.join(root, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

describe("hook touched paths", () => {
  test("normalizes adapter-provided paths and apply_patch paths", async () => {
    const root = await makeTestRoot();
    try {
      expect(
        extractTouchedPaths({
          agent: "codex",
          hook: "post-edit",
          cwd: root,
          touchedPathCandidates: ["src/index.ts", "../outside.ts"],
          patchText:
            "*** Begin Patch\n*** Update File: scripts/validation/validate.ts\n*** End Patch",
        }),
      ).toEqual(["scripts/validation/validate.ts", "src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("extracts apply_patch file hunks", () => {
    expect(
      extractApplyPatchPaths(`*** Begin Patch
*** Add File: src/a.ts
*** Update File: scripts/b.ts
*** Delete File: src/c.ts
*** End Patch`),
    ).toEqual(["src/a.ts", "scripts/b.ts", "src/c.ts"]);
  });

  test("Claude Stop can read pending paths recorded by a tool hook without turn ids", async () => {
    const root = await makeTestRoot();
    try {
      await recordTouchedPaths(
        {
          agent: "claude",
          hook: "post-edit",
          cwd: root,
          sessionId: "session",
          toolCallId: "toolu_123",
          touchedPathCandidates: [],
        },
        ["src/index.ts"],
      );

      expect(
        await readTouchedPaths({
          agent: "claude",
          hook: "stop",
          cwd: root,
          sessionId: "session",
          touchedPathCandidates: [],
        }),
      ).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps touched path state isolated by session id", async () => {
    const root = await makeTestRoot();
    const event = {
      agent: "codex" as const,
      hook: "post-edit" as const,
      cwd: root,
      touchedPathCandidates: [],
    };
    try {
      await recordTouchedPaths({ ...event, sessionId: "session-a" }, ["AGENTS.md"]);
      await recordTouchedPaths({ ...event, sessionId: "session-b" }, ["src/index.ts"]);

      expect(await readTouchedPaths({ ...event, sessionId: "session-a" })).toEqual(["AGENTS.md"]);
      expect(await readTouchedPaths({ ...event, sessionId: "session-b" })).toEqual([
        "src/index.ts",
      ]);

      await clearTouchedPaths({ ...event, sessionId: "session-b" });

      expect(await readTouchedPaths({ ...event, sessionId: "session-a" })).toEqual(["AGENTS.md"]);
      expect(await readTouchedPaths({ ...event, sessionId: "session-b" })).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prunes stale state files without deleting the current session", async () => {
    const root = await makeTestRoot();
    const event = {
      agent: "codex" as const,
      hook: "post-edit" as const,
      cwd: root,
      touchedPathCandidates: [],
    };
    const oldSession = { ...event, sessionId: "old-session" };
    const currentSession = { ...event, sessionId: "current-session" };
    try {
      await recordTouchedPaths(oldSession, ["AGENTS.md"]);
      await recordTouchedPaths(currentSession, ["src/index.ts"]);

      const now = Date.now();
      const staleDate = new Date(now - TOUCHED_STATE_TTL_MS - 1_000);
      const oldPath = pendingTouchedStatePath(oldSession);
      const currentPath = pendingTouchedStatePath(currentSession);
      await utimes(oldPath, staleDate, staleDate);
      await utimes(currentPath, staleDate, staleDate);

      await pruneStaleTouchedState(currentSession, now);

      expect(await Bun.file(oldPath).exists()).toBe(false);
      expect(await Bun.file(currentPath).exists()).toBe(true);
      expect(await readTouchedPaths(currentSession)).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
