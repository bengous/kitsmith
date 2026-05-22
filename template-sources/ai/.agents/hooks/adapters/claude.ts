#!/usr/bin/env bun

import type {
  AgentAdapter,
  AgentFeedbackResult,
  AgentHookEvent,
  AgentHookKind,
  UpdatedFileSnapshot,
} from "../core/contract.ts";
import path from "node:path";
import { isRecord, valueAsString } from "../runtime/unknown-value.ts";

export const claudeAdapter: AgentAdapter = {
  agent: "claude",
  capabilities: { updatedToolOutput: true },
  readEvent: readClaudeHookEvent,
  printPostEditResult: printClaudePostToolUseResult,
  printStopResult: printClaudeResult,
  printPreToolDeny: printClaudePreToolUseDeny,
};

export async function readClaudeHookEvent(hook: AgentHookKind): Promise<AgentHookEvent> {
  const text = await Bun.stdin.text();
  if (text.trim() === "") {
    return emptyClaudeEvent(hook);
  }
  return parseClaudeHookInput(JSON.parse(text) as unknown, hook);
}

export function parseClaudeHookInput(
  value: unknown,
  hook: AgentHookKind = "post-edit",
): AgentHookEvent {
  if (!isRecord(value)) {
    return emptyClaudeEvent(hook);
  }

  const sessionId = valueAsString(value["session_id"]);
  const transcriptPath = valueAsString(value["transcript_path"]);
  const cwd = valueAsString(value["cwd"]) ?? process.env["CLAUDE_PROJECT_DIR"];
  const toolUseId = valueAsString(value["tool_use_id"]);
  const toolName = valueAsString(value["tool_name"]);
  const stopHookActive = value["stop_hook_active"];
  const toolInput = isRecord(value["tool_input"]) ? value["tool_input"] : {};
  const command = valueAsString(toolInput["command"]);

  return {
    agent: "claude",
    hook,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(toolUseId === undefined ? {} : { toolCallId: toolUseId }),
    ...(typeof stopHookActive === "boolean" ? { stopHookActive } : {}),
    touchedPathCandidates: touchedPathCandidates(toolInput),
    ...(command === undefined ? {} : { patchText: command, toolCommand: command }),
    ...("tool_response" in value ? { nativeToolResponse: value["tool_response"] } : {}),
  };
}

export function printClaudeResult(result: AgentFeedbackResult): void {
  const payload = claudePayload(result);
  if (Object.keys(payload).length > 0) {
    console.log(JSON.stringify(payload));
  }
}

export function printClaudePreToolUseDeny(reason: string): void {
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

export function claudePostToolUsePayload(
  result: AgentFeedbackResult,
  event: AgentHookEvent = emptyClaudeEvent("post-edit"),
): Record<string, unknown> | null {
  const payload = claudePayload(result);
  const updatedToolOutput = claudeUpdatedToolOutput(result, event);

  if (
    updatedToolOutput === undefined &&
    !isRecord(payload["hookSpecificOutput"]) &&
    result.blockReason === undefined
  ) {
    return null;
  }

  if (updatedToolOutput === undefined) {
    return payload;
  }

  const hookSpecificOutput = {
    ...(isRecord(payload["hookSpecificOutput"]) ? payload["hookSpecificOutput"] : {}),
    hookEventName: "PostToolUse",
    updatedToolOutput,
  };

  return { ...payload, hookSpecificOutput };
}

export function printClaudePostToolUseResult(
  result: AgentFeedbackResult,
  event: AgentHookEvent,
): void {
  const payload = claudePostToolUsePayload(result, event);
  if (payload !== null) {
    console.log(JSON.stringify(payload));
  }
}

function claudePayload(result: AgentFeedbackResult): Record<string, unknown> {
  return {
    ...(result.blockReason === undefined ? {} : { decision: "block", reason: result.blockReason }),
    ...(result.systemMessage === undefined
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: result.systemMessage,
          },
        }),
  };
}

function emptyClaudeEvent(hook: AgentHookKind): AgentHookEvent {
  return { agent: "claude", hook, touchedPathCandidates: [] };
}

function claudeUpdatedToolOutput(
  result: AgentFeedbackResult,
  event: AgentHookEvent,
): Record<string, unknown> | undefined {
  if (result.updatedFile === undefined) {
    return undefined;
  }
  if (event.toolName === undefined) {
    return undefined;
  }

  switch (event.toolName) {
    case "Write":
      return writeUpdatedToolOutput(result.updatedFile, event);
    case "Edit":
      return editUpdatedToolOutput(result.updatedFile, event);
    case "MultiEdit":
      // TODO: capture a real Claude PostToolUse payload before supporting MultiEdit.
      // Public indexed examples and the inspected SDK package do not expose a
      // reliable MultiEdit output shape, so returning raw file content here would
      // violate Claude's same-shape updatedToolOutput contract.
      return undefined;
    default:
      return undefined;
  }
}

function writeUpdatedToolOutput(
  updatedFile: UpdatedFileSnapshot,
  event: AgentHookEvent,
): Record<string, unknown> | undefined {
  const response = event.nativeToolResponse;
  if (!isRecord(response) || !sameFile(response["filePath"], updatedFile.path, event.cwd)) {
    return undefined;
  }

  if (typeof response["content"] !== "string") {
    return undefined;
  }

  return { ...response, content: updatedFile.after };
}

function editUpdatedToolOutput(
  updatedFile: UpdatedFileSnapshot,
  event: AgentHookEvent,
): Record<string, unknown> | undefined {
  const response = event.nativeToolResponse;
  if (!isRecord(response) || !sameFile(response["filePath"], updatedFile.path, event.cwd)) {
    return undefined;
  }

  if (
    typeof response["oldString"] !== "string" ||
    typeof response["newString"] !== "string" ||
    !("originalFile" in response)
  ) {
    return undefined;
  }

  return { ...response };
}

function sameFile(value: unknown, updatedPath: string, cwd: string | undefined): boolean {
  const responsePath = valueAsString(value);
  if (responsePath === undefined) {
    return false;
  }

  const normalizedUpdatedPath = normalizePath(updatedPath);
  const normalizedResponsePath = normalizePath(responsePath);
  if (normalizedResponsePath === normalizedUpdatedPath) {
    return true;
  }

  if (cwd === undefined || path.isAbsolute(updatedPath)) {
    return false;
  }

  return normalizePath(responsePath) === normalizePath(`${cwd}/${updatedPath}`);
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath).replaceAll(path.sep, "/");
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
