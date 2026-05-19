import type { CommandResult } from "./contract.ts";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runStopValidation } from "./stop-validation.ts";
import { readTouchedPaths, recordTouchedPaths } from "./touched-paths.ts";

async function makeTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-stop-"));
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

describe("stop validation", () => {
  test("skips recursive stop hooks", async () => {
    const calls: string[] = [];
    const result = await runStopValidation(
      { agent: "codex", hook: "stop", stopHookActive: true, touchedPathCandidates: [] },
      async (command): Promise<CommandResult> => {
        calls.push(command.join(" "));
        return { code: 1, stdout: "", stderr: "" };
      },
    );

    expect(result.blockReason).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("clears pending state on success and preserves it on failure", async () => {
    const root = await makeTestRoot();
    const event = {
      agent: "claude" as const,
      hook: "stop" as const,
      cwd: root,
      sessionId: "session",
      touchedPathCandidates: [],
    };
    try {
      await recordTouchedPaths(event, ["src/index.ts"]);
      await runStopValidation(event, async () => ({ code: 0, stdout: "", stderr: "" }));
      expect(await readTouchedPaths(event)).toEqual([]);

      await recordTouchedPaths(event, ["src/index.ts"]);
      await runStopValidation(event, async () => ({ code: 1, stdout: "failed\n", stderr: "" }));
      expect(await readTouchedPaths(event)).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks generated pending paths before running validation", async () => {
    const root = await makeTestRoot();
    const calls: string[] = [];
    const event = {
      agent: "codex" as const,
      hook: "stop" as const,
      cwd: root,
      sessionId: "session",
      touchedPathCandidates: [],
    };
    try {
      await seedFile(
        root,
        ".agents/agents-md-manifest.json",
        JSON.stringify({ generated: ["AGENTS.md"], outputs: {} }),
      );
      await recordTouchedPaths(event, ["AGENTS.md"]);

      const result = await runStopValidation(event, async (command): Promise<CommandResult> => {
        calls.push(command.join(" "));
        return { code: 0, stdout: "", stderr: "" };
      });

      expect(result.blockReason).toContain(
        "Generated files must not be edited directly: AGENTS.md",
      );
      expect(calls).toEqual([]);
      expect(await readTouchedPaths(event)).toEqual(["AGENTS.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns useful failure output when validation fails", async () => {
    const root = await makeTestRoot();
    try {
      const result = await runStopValidation(
        {
          agent: "claude",
          hook: "stop",
          cwd: root,
          sessionId: "session",
          touchedPathCandidates: [],
        },
        async () => ({
          code: 2,
          stdout: "Validation failed:\n[typecheck:frontend] src/routes/index.tsx failed\n",
          stderr: "lint failed\n",
        }),
      );

      expect(result.blockReason).toContain("Stop validation failed:");
      expect(result.blockReason).toContain("[typecheck:frontend] src/routes/index.tsx failed");
      expect(result.blockReason).toContain("lint failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
