import type { CommandResult, CommandRunnerOptions } from "./contract.ts";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MissingSessionIdError } from "./session.ts";
import { runStopValidation } from "./stop-validation.ts";
import { readTouchedPaths, recordTouchedPaths } from "./touched-paths.ts";

async function makeTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-stop-"));
  await seedFile(root, ".agents/agents-md-manifest.json", "{}\n");
  await seedFile(root, ".gitignore", ".agents/tmp/\n");
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

function eventFor(root: string, sessionId = "session") {
  return {
    agent: "codex" as const,
    hook: "stop" as const,
    cwd: root,
    sessionId,
    touchedPathCandidates: [],
  };
}

async function recordDefaultTouchedPath(event: ReturnType<typeof eventFor>): Promise<void> {
  await recordTouchedPaths(event, ["src/index.ts"]);
}

function failureRecord(options: CommandRunnerOptions, overrides: Record<string, unknown>): string {
  return `${JSON.stringify({
    protocol: "kitsmith.stop-validation",
    version: 1,
    type: "failure",
    runId: options.env?.["KITSMITH_STOP_RUN_ID"],
    failureKind: "validation_failed",
    ...overrides,
  })}\n`;
}

describe("stop validation", () => {
  test("skips recursive stop hooks before requiring a session id", async () => {
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

  test("requires session-scoped hook payloads", async () => {
    const root = await makeTestRoot();
    try {
      let thrown: unknown;
      try {
        await runStopValidation({
          agent: "codex",
          hook: "stop",
          cwd: root,
          touchedPathCandidates: [],
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MissingSessionIdError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips validation when the current session has no touched paths", async () => {
    const root = await makeTestRoot();
    const calls: string[] = [];
    try {
      const result = await runStopValidation(
        eventFor(root),
        async (command): Promise<CommandResult> => {
          calls.push(command.join(" "));
          return { code: 0, stdout: "", stderr: "" };
        },
      );

      expect(result.blockReason).toBeUndefined();
      expect(calls).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("passes only the current session touched paths to validation", async () => {
    const root = await makeTestRoot();
    const sessionA = eventFor(root, "session-a");
    const sessionB = eventFor(root, "session-b");
    const validationEnvs: Array<Readonly<Record<string, string | undefined>>> = [];
    try {
      await seedFile(
        root,
        ".agents/agents-md-manifest.json",
        JSON.stringify({ generated: ["AGENTS.md"], outputs: {} }),
      );
      await recordTouchedPaths(sessionA, ["AGENTS.md"]);
      await recordTouchedPaths(sessionB, ["src/index.ts"]);

      const result = await runStopValidation(sessionB, async (_command, options) => {
        validationEnvs.push(options.env ?? {});
        return { code: 0, stdout: "", stderr: "" };
      });

      expect(result.blockReason).toBeUndefined();
      expect(validationEnvs).toHaveLength(1);
      expect(validationEnvs[0]?.["KITSMITH_STOP_SESSION_ID"]).toBe("session-b");
      expect(validationEnvs[0]?.["KITSMITH_STOP_RUN_ID"]).toBeString();
      expect(validationEnvs[0]?.["KITSMITH_STOP_RUN_ID"]).not.toBe("session-b");
      expect(validationEnvs[0]?.["KITSMITH_STOP_CHANGED_FILES_JSON"]).toBe(
        JSON.stringify(["src/index.ts"]),
      );
      expect(await readTouchedPaths(sessionA)).toEqual(["AGENTS.md"]);
      expect(await readTouchedPaths(sessionB)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks generated pending paths for the current session before running validation", async () => {
    const root = await makeTestRoot();
    const calls: string[] = [];
    const event = eventFor(root);
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

  test("clears pending state on success and preserves it on failure", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    try {
      await recordDefaultTouchedPath(event);
      await runStopValidation(event, async () => ({ code: 0, stdout: "", stderr: "" }));
      expect(await readTouchedPaths(event)).toEqual([]);

      await recordDefaultTouchedPath(event);
      await runStopValidation(event, async () => ({
        code: 1,
        stdout: "failed\n",
        stderr: "",
      }));
      expect(await readTouchedPaths(event)).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks non-JSONL validation failure output as an invalid protocol", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async () => ({
        code: 2,
        stdout: "Validation failed:\n[typecheck:frontend] src/routes/index.tsx failed\n",
        stderr: "lint failed\n",
      }));

      expect(result.blockReason).toContain("invalid validation protocol");
      expect(result.blockReason).toContain("[typecheck:frontend] src/routes/index.tsx failed");
      expect(result.blockReason).toContain("lint failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses JSONL validation failure records instead of raw command output", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    const stdoutRef = `${root}/.agents/tmp/hooks/stop/session/run/typecheck-stdout.txt`;
    const noisyOutput = Array.from({ length: 200 }, (_, index) => `wrote file-${index}`).join("\n");
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async (_command, options) => ({
        code: 2,
        stdout: failureRecord(options, {
          step: "typecheck",
          exitCode: 2,
          stdoutTail: noisyOutput,
          stdoutRef,
          actionHint: "Run `bun run typecheck` outside the Stop hook and fix the failure.",
        }),
        stderr: "",
      }));

      expect(result.blockReason).toContain("Stop validation failed in typecheck");
      expect(result.blockReason).toContain(`stdout: ${stdoutRef}`);
      expect(result.blockReason).toContain("Run `bun run typecheck`");
      expect(result.blockReason).not.toContain("wrote file-199");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps ignored protocol artifacts from masking validation failures", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    let stdoutRef = "";
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async (_command, options) => {
        const runId = options.env?.["KITSMITH_STOP_RUN_ID"] ?? "missing-run-id";
        stdoutRef = path.join(
          ".agents",
          "tmp",
          "hooks",
          "stop",
          "session",
          runId,
          "typecheck-stdout.txt",
        );
        await seedFile(root, stdoutRef, "full validation output\n");
        return {
          code: 2,
          stdout: failureRecord(options, {
            runId,
            step: "typecheck",
            exitCode: 2,
            stdoutRef,
            actionHint: "Run `bun run typecheck` outside the Stop hook and fix the failure.",
          }),
          stderr: "",
        };
      });

      expect(result.blockReason).toContain("Stop validation failed in typecheck");
      expect(result.blockReason).toContain(`stdout: ${stdoutRef}`);
      expect(result.blockReason).not.toContain("read-only violation");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects validation records with a mismatched run id", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async (_command, options) => ({
        code: 2,
        stdout: failureRecord(options, {
          runId: "not-the-generated-run-id",
        }),
        stderr: "",
      }));

      expect(result.blockReason).toContain("invalid validation protocol");
      expect(result.blockReason).toContain("runId was missing or mismatched");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unknown validation protocol records", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async (_command, options) => ({
        code: 2,
        stdout: `${JSON.stringify({
          protocol: "kitsmith.stop-validation",
          version: 1,
          type: "progress",
          runId: options.env?.["KITSMITH_STOP_RUN_ID"],
        })}\n`,
        stderr: "",
      }));

      expect(result.blockReason).toContain("invalid validation protocol");
      expect(result.blockReason).toContain("unknown protocol record");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("turns unclassified step records into refusal feedback", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async (_command, options) => ({
        code: 3,
        stdout: failureRecord(options, {
          failureKind: "unclassified_stop_step",
          step: "agents:sync",
          exitCode: 3,
          actionHint: "Classify the Stop validation step as read-only or remove it from Stop.",
        }),
        stderr: "",
      }));

      expect(result.blockReason).toContain(
        "Stop validation refused unclassified step: agents:sync",
      );
      expect(result.blockReason).toContain(
        "Classify the Stop validation step as read-only or remove it from Stop.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks invalid validation protocol with a bounded raw excerpt", async () => {
    const root = await makeTestRoot();
    const event = eventFor(root);
    try {
      await recordDefaultTouchedPath(event);

      const result = await runStopValidation(event, async () => ({
        code: 2,
        stdout: Array.from({ length: 80 }, (_, index) => `raw line ${index}`).join("\n"),
        stderr: "",
      }));

      expect(result.blockReason).toContain("invalid validation protocol");
      expect(result.blockReason).toContain("Raw output excerpt:");
      expect(result.blockReason).toContain("raw line 79");
      expect(result.blockReason).not.toContain("raw line 0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
