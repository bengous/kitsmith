import type { CommandResult } from "./contract.ts";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { claudePostToolUsePayload } from "../adapters/claude.ts";
import { isRecord } from "../runtime/unknown-value.ts";
import { runPostEditQuality } from "./post-edit-quality.ts";

async function makeTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-post-edit-"));
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

function isTool(command: readonly string[], name: string): boolean {
  return path.basename(command[0] ?? "").replace(/\.(cmd|exe)$/i, "") === name;
}

describe("post-edit quality", () => {
  test("returns an updated file snapshot when formatting changes one touched file", async () => {
    const root = await makeTestRoot();
    try {
      await seedFile(root, "src/index.ts", "export const main=true;\n");
      const formatted = "export const main = true;\n";

      const result = await runPostEditQuality(
        {
          agent: "claude",
          hook: "post-edit",
          cwd: root,
          sessionId: "session",
          toolCallId: "toolu_123",
          touchedPathCandidates: ["src/index.ts"],
        },
        async (command): Promise<CommandResult> => {
          if (isTool(command, "oxfmt")) {
            await writeFile(path.join(root, "src/index.ts"), formatted);
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      );

      expect(result.updatedFile).toEqual({
        path: "src/index.ts",
        before: "export const main=true;\n",
        after: formatted,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps updated file snapshot when lint fails after one-file formatting", async () => {
    const root = await makeTestRoot();
    try {
      await seedFile(root, "src/index.ts", "export const main=true;\n");
      const formatted = "export const main = true;\n";

      const result = await runPostEditQuality(
        {
          agent: "claude",
          hook: "post-edit",
          cwd: root,
          sessionId: "session",
          toolCallId: "toolu_123",
          touchedPathCandidates: ["src/index.ts"],
        },
        async (command): Promise<CommandResult> => {
          if (isTool(command, "oxfmt")) {
            await writeFile(path.join(root, "src/index.ts"), formatted);
          }
          return command.includes("--format=unix")
            ? { code: 1, stdout: "src/index.ts:1:1: lint failed\n", stderr: "" }
            : { code: 0, stdout: "", stderr: "" };
        },
      );

      expect(result.blockReason).toContain("Post-edit quality gate failed");
      expect(result.updatedFile?.after).toBe(formatted);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks with install guidance when local quality tooling is missing", async () => {
    const root = await makeTestRoot();
    try {
      const result = await runPostEditQuality(
        {
          agent: "claude",
          hook: "post-edit",
          cwd: root,
          sessionId: "session",
          toolCallId: "toolu_123",
          touchedPathCandidates: ["src/index.ts"],
        },
        async (): Promise<CommandResult> => ({
          code: 127,
          stdout: "",
          stderr:
            "Hook command is unavailable: oxlint.\nRun `bun install` in this project, then retry the agent action.",
        }),
      );

      expect(result.blockReason).toContain("Post-edit quality gate failed");
      expect(result.blockReason).toContain("Hook command is unavailable: oxlint.");
      expect(result.blockReason).toContain("Run `bun install` in this project");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Claude Write payload emits same-shape updatedToolOutput instead of raw file content", () => {
    const payload = claudePostToolUsePayload(
      {
        updatedFile: {
          path: "src/index.ts",
          before: "export const main=true;\n",
          after: "export const main = true;\n",
        },
      },
      {
        agent: "claude",
        hook: "post-edit",
        cwd: "/repo",
        toolName: "Write",
        touchedPathCandidates: ["src/index.ts"],
        nativeToolResponse: {
          type: "update",
          filePath: "/repo/src/index.ts",
          content: "export const main=true;\n",
          structuredPatch: [],
          originalFile: "old",
          gitDiff: { filename: "src/index.ts", status: "modified" },
          extra: true,
        },
      },
    );

    expect(payload?.["hookSpecificOutput"]).toEqual({
      hookEventName: "PostToolUse",
      updatedToolOutput: {
        type: "update",
        filePath: "/repo/src/index.ts",
        content: "export const main = true;\n",
        structuredPatch: [],
        originalFile: "old",
        gitDiff: { filename: "src/index.ts", status: "modified" },
        extra: true,
      },
    });
    const hookSpecificOutput = payload?.["hookSpecificOutput"];
    expect(isRecord(hookSpecificOutput)).toBeTrue();
    if (!isRecord(hookSpecificOutput)) {
      throw new TypeError("Expected hookSpecificOutput to be an object");
    }
    expect(typeof hookSpecificOutput["updatedToolOutput"]).toBe("object");
  });

  test("Claude Edit payload preserves a recognized shape without inventing full content", () => {
    const payload = claudePostToolUsePayload(
      {
        updatedFile: {
          path: "src/index.ts",
          before: "export const main=true;\n",
          after: "export const main = true;\n",
        },
      },
      {
        agent: "claude",
        hook: "post-edit",
        cwd: "/repo",
        toolName: "Edit",
        touchedPathCandidates: ["src/index.ts"],
        nativeToolResponse: {
          filePath: "src/index.ts",
          oldString: "main=true",
          newString: "main = true",
          originalFile: "export const main=true;\n",
          structuredPatch: [],
          replaceAll: false,
          userModified: false,
        },
      },
    );

    expect(payload?.["hookSpecificOutput"]).toEqual({
      hookEventName: "PostToolUse",
      updatedToolOutput: {
        filePath: "src/index.ts",
        oldString: "main=true",
        newString: "main = true",
        originalFile: "export const main=true;\n",
        structuredPatch: [],
        replaceAll: false,
        userModified: false,
      },
    });
  });

  test("Claude block payload can still include a shape-compatible updatedToolOutput", () => {
    const payload = claudePostToolUsePayload(
      {
        blockReason: "Post-edit quality gate failed",
        updatedFile: {
          path: "src/index.ts",
          before: "export const main=true;\n",
          after: "export const main = true;\n",
        },
      },
      {
        agent: "claude",
        hook: "post-edit",
        cwd: "/repo",
        toolName: "Write",
        touchedPathCandidates: ["src/index.ts"],
        nativeToolResponse: {
          type: "update",
          filePath: "src/index.ts",
          content: "export const main=true;\n",
          structuredPatch: [],
          originalFile: "old",
        },
      },
    );

    expect(payload).toEqual({
      decision: "block",
      reason: "Post-edit quality gate failed",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: {
          type: "update",
          filePath: "src/index.ts",
          content: "export const main = true;\n",
          structuredPatch: [],
          originalFile: "old",
        },
      },
    });
  });

  test("Claude unsupported response shapes do not emit invalid updatedToolOutput", () => {
    const result = {
      updatedFile: {
        path: "src/index.ts",
        before: "export const main=true;\n",
        after: "export const main = true;\n",
      },
    };

    expect(
      claudePostToolUsePayload(result, {
        agent: "claude",
        hook: "post-edit",
        toolName: "Write",
        touchedPathCandidates: ["src/index.ts"],
        nativeToolResponse: { filePath: "src/index.ts", success: true },
      }),
    ).toBeNull();

    expect(
      claudePostToolUsePayload(result, {
        agent: "claude",
        hook: "post-edit",
        toolName: "Read",
        touchedPathCandidates: ["src/index.ts"],
        nativeToolResponse: "raw output",
      }),
    ).toBeNull();
  });

  test("Claude MultiEdit stays explicitly unsupported until a real payload is captured", () => {
    expect(
      claudePostToolUsePayload(
        {
          updatedFile: {
            path: "src/index.ts",
            before: "export const main=true;\n",
            after: "export const main = true;\n",
          },
        },
        {
          agent: "claude",
          hook: "post-edit",
          toolName: "MultiEdit",
          touchedPathCandidates: ["src/index.ts"],
          nativeToolResponse: {
            filePath: "src/index.ts",
            content: "export const main=true;\n",
          },
        },
      ),
    ).toBeNull();
  });

  test("Claude payload keeps plain blocks free of empty hookSpecificOutput", () => {
    expect(claudePostToolUsePayload({ blockReason: "failed" })).toEqual({
      decision: "block",
      reason: "failed",
    });
  });
});
