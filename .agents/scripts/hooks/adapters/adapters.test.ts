import { describe, expect, test } from "bun:test";
import { claudeAdapter, parseClaudeHookInput } from "./claude.ts";
import { codexAdapter, parseCodexHookInput } from "./codex.ts";
import { piAdapter, parsePiHookInput } from "./pi.ts";

describe("hook adapters", () => {
  test("Codex maps native fields to canonical hook events", () => {
    expect(
      parseCodexHookInput(
        {
          session_id: "session",
          turn_id: "turn",
          cwd: "/repo",
          tool_input: { file_path: "src/index.ts" },
        },
        "post-edit",
      ),
    ).toEqual({
      agent: "codex",
      hook: "post-edit",
      sessionId: "session",
      toolCallId: "turn",
      cwd: "/repo",
      touchedPathCandidates: ["src/index.ts"],
    });
  });

  test("Codex maps native command payloads to command and patch text", () => {
    const command = "*** Begin Patch\n*** Update File: src/index.ts\n*** End Patch\n";

    expect(
      parseCodexHookInput(
        {
          session_id: "session",
          turn_id: "turn",
          cwd: "/repo",
          tool_input: { command },
        },
        "pre-tool",
      ),
    ).toEqual({
      agent: "codex",
      hook: "pre-tool",
      sessionId: "session",
      toolCallId: "turn",
      cwd: "/repo",
      touchedPathCandidates: [],
      patchText: command,
      toolCommand: command,
    });
  });

  test("Codex maps MultiEdit-style edits to touched path candidates", () => {
    expect(
      parseCodexHookInput({
        tool_input: {
          edits: [
            { file_path: "src/a.ts" },
            { filePath: "scripts/b.ts" },
            { path: "apps/frontend/src/main.tsx" },
            { ignored: true },
          ],
        },
      }),
    ).toEqual({
      agent: "codex",
      hook: "post-edit",
      touchedPathCandidates: ["src/a.ts", "scripts/b.ts", "apps/frontend/src/main.tsx"],
    });
  });

  test("Claude maps tool_use_id without requiring turn_id", () => {
    expect(
      parseClaudeHookInput(
        {
          session_id: "session",
          transcript_path: "/tmp/transcript.jsonl",
          cwd: "/repo",
          hook_event_name: "PostToolUse",
          tool_use_id: "toolu_123",
          tool_name: "Write",
          tool_input: { file_path: "src/index.ts" },
          tool_response: { filePath: "src/index.ts", content: "formatted" },
        },
        "post-edit",
      ),
    ).toEqual({
      agent: "claude",
      hook: "post-edit",
      sessionId: "session",
      transcriptPath: "/tmp/transcript.jsonl",
      cwd: "/repo",
      toolCallId: "toolu_123",
      toolName: "Write",
      touchedPathCandidates: ["src/index.ts"],
      nativeToolResponse: { filePath: "src/index.ts", content: "formatted" },
    });
  });

  test("Claude maps MultiEdit-style edits to touched path candidates", () => {
    expect(
      parseClaudeHookInput({
        tool_input: {
          edits: [
            { file_path: "src/a.ts" },
            { filePath: "scripts/b.ts" },
            { path: "apps/frontend/src/main.tsx" },
            { ignored: true },
          ],
        },
      }),
    ).toEqual({
      agent: "claude",
      hook: "post-edit",
      touchedPathCandidates: ["src/a.ts", "scripts/b.ts", "apps/frontend/src/main.tsx"],
    });
  });

  test("Claude uses CLAUDE_PROJECT_DIR when native cwd is absent", () => {
    const previous = process.env["CLAUDE_PROJECT_DIR"];
    process.env["CLAUDE_PROJECT_DIR"] = "/repo-from-env";
    try {
      expect(parseClaudeHookInput({ session_id: "session" })).toEqual({
        agent: "claude",
        hook: "post-edit",
        sessionId: "session",
        cwd: "/repo-from-env",
        touchedPathCandidates: [],
      });
    } finally {
      if (previous === undefined) {
        delete process.env["CLAUDE_PROJECT_DIR"];
      } else {
        process.env["CLAUDE_PROJECT_DIR"] = previous;
      }
    }
  });

  test("adapter capabilities describe updatedToolOutput support explicitly", () => {
    expect(claudeAdapter.capabilities.updatedToolOutput).toBeTrue();
    expect(codexAdapter.capabilities.updatedToolOutput).toBeFalse();
    expect(piAdapter.capabilities.updatedToolOutput).toBeFalse();
  });

  test("adapters translate native recursive-stop fields to the canonical event", () => {
    expect(parseCodexHookInput({ stop_hook_active: true }, "stop")).toEqual({
      agent: "codex",
      hook: "stop",
      stopHookActive: true,
      touchedPathCandidates: [],
    });

    expect(parseClaudeHookInput({ stop_hook_active: true }, "stop")).toEqual({
      agent: "claude",
      hook: "stop",
      stopHookActive: true,
      touchedPathCandidates: [],
    });
  });

  test("Pi maps extension hook payloads to canonical events", () => {
    expect(
      parsePiHookInput(
        {
          projectRoot: "/repo",
          runId: "run",
          eventId: "event",
          toolName: "edit",
          command: "echo test",
          edit: { paths: ["src/a.ts", "scripts/b.ts"] },
        },
        "post-edit",
      ),
    ).toEqual({
      agent: "pi",
      hook: "post-edit",
      cwd: "/repo",
      sessionId: "run",
      toolCallId: "event",
      toolName: "edit",
      touchedPathCandidates: ["src/a.ts", "scripts/b.ts"],
      patchText: "echo test",
      toolCommand: "echo test",
    });
  });
});
