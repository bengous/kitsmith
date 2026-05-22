#!/usr/bin/env bun

import type {
  AgentAdapter,
  AgentFeedbackResult,
  AgentHookEvent,
  AgentHookKind,
} from "../core/contract.ts";
import { isRecord, valueAsString } from "../runtime/unknown-value.ts";

export const codexAdapter: AgentAdapter = {
  agent: "codex",
  capabilities: { updatedToolOutput: false },
  readEvent: readCodexHookEvent,
  printPostEditResult: printCodexPostToolUseResult,
  printStopResult: printCodexStopResult,
  printPreToolDeny: printCodexPreToolUseDeny,
};

export async function readCodexHookEvent(hook: AgentHookKind): Promise<AgentHookEvent> {
  const text = await Bun.stdin.text();
  if (text.trim() === "") {
    return emptyCodexEvent(hook);
  }
  return parseCodexHookInput(JSON.parse(text) as unknown, hook);
}

export function parseCodexHookInput(
  value: unknown,
  hook: AgentHookKind = "post-edit",
): AgentHookEvent {
  if (!isRecord(value)) {
    return emptyCodexEvent(hook);
  }

  const sessionId = valueAsString(value["session_id"]);
  const turnId = valueAsString(value["turn_id"]);
  const cwd = valueAsString(value["cwd"]);
  const stopHookActive = value["stop_hook_active"];
  const toolInput = isRecord(value["tool_input"]) ? value["tool_input"] : {};
  const command = valueAsString(toolInput["command"]);

  return {
    agent: "codex",
    hook,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(turnId === undefined ? {} : { toolCallId: turnId }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(typeof stopHookActive === "boolean" ? { stopHookActive } : {}),
    touchedPathCandidates: touchedPathCandidates(toolInput),
    ...(command === undefined ? {} : { patchText: command, toolCommand: command }),
  };
}

export function printCodexPostToolUseResult(result: AgentFeedbackResult): void {
  if (result.blockReason !== undefined) {
    console.log(JSON.stringify({ decision: "block", reason: result.blockReason }));
    return;
  }

  if (result.systemMessage !== undefined) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: result.systemMessage,
        },
      }),
    );
  }
}

export function printCodexPreToolUseDeny(reason: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

export function printCodexStopResult(result: AgentFeedbackResult): void {
  if (result.blockReason !== undefined) {
    console.log(JSON.stringify({ decision: "block", reason: result.blockReason }));
    return;
  }

  console.log(
    JSON.stringify({
      continue: true,
      ...(result.systemMessage === undefined ? {} : { systemMessage: result.systemMessage }),
    }),
  );
}

function emptyCodexEvent(hook: AgentHookKind): AgentHookEvent {
  return { agent: "codex", hook, touchedPathCandidates: [] };
}

function touchedPathCandidates(toolInput: Record<string, unknown>): string[] {
  return [...singlePathFields(toolInput), ...editPathFields(toolInput)];
}

function singlePathFields(toolInput: Record<string, unknown>): readonly string[] {
  const paths: string[] = [];
  for (const key of ["file_path", "filePath", "path"]) {
    const value = valueAsString(toolInput[key]);
    if (value !== undefined) {
      paths.push(value);
    }
  }
  return paths;
}

function editPathFields(toolInput: Record<string, unknown>): readonly string[] {
  const edits = toolInput["edits"];
  if (!Array.isArray(edits)) {
    return [];
  }

  const paths: string[] = [];
  for (const edit of edits) {
    if (!isRecord(edit)) {
      continue;
    }
    const value = valueAsString(edit["file_path"] ?? edit["filePath"] ?? edit["path"]);
    if (value !== undefined) {
      paths.push(value);
    }
  }
  return paths;
}
