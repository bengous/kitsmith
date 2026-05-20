#!/usr/bin/env bun

import type {
  AgentAdapter,
  AgentFeedbackResult,
  AgentHookEvent,
  AgentHookKind,
} from "../core/contract.ts";
import { isRecord, stringArray, valueAsString } from "../runtime/unknown-value.ts";

export const piAdapter: AgentAdapter = {
  agent: "pi",
  capabilities: { updatedToolOutput: false },
  readEvent: readPiHookEvent,
  printPostEditResult: printPiResult,
  printStopResult: printPiResult,
  printPreToolDeny: (reason) => printPiResult({ blockReason: reason }),
};

export async function readPiHookEvent(hook: AgentHookKind): Promise<AgentHookEvent> {
  const text = await Bun.stdin.text();
  return text.trim() === ""
    ? emptyPiEvent(hook)
    : parsePiHookInput(JSON.parse(text) as unknown, hook);
}

export function parsePiHookInput(
  value: unknown,
  hook: AgentHookKind = "post-edit",
): AgentHookEvent {
  if (!isRecord(value)) {
    return emptyPiEvent(hook);
  }

  const projectRoot = typeof value["projectRoot"] === "string" ? value["projectRoot"] : undefined;
  const runId = typeof value["runId"] === "string" ? value["runId"] : undefined;
  const eventId = typeof value["eventId"] === "string" ? value["eventId"] : undefined;
  const eventHook = valueAsString(value["hook"]);
  const toolName = valueAsString(value["toolName"]);
  const command = valueAsString(value["command"]);
  const edit = isRecord(value["edit"]) ? value["edit"] : {};
  const path = valueAsString(edit["path"]);
  const paths = stringArray(edit["paths"]);

  return {
    agent: "pi",
    hook:
      eventHook === "pre-tool" || eventHook === "post-edit" || eventHook === "stop"
        ? eventHook
        : hook,
    ...(projectRoot === undefined ? {} : { cwd: projectRoot }),
    ...(runId === undefined ? {} : { sessionId: runId }),
    ...(eventId === undefined ? {} : { toolCallId: eventId }),
    ...(toolName === undefined ? {} : { toolName }),
    touchedPathCandidates: [...(path === undefined ? [] : [path]), ...paths],
    ...(command === undefined ? {} : { patchText: command, toolCommand: command }),
  };
}

export function printPiResult(result: AgentFeedbackResult): void {
  console.log(
    JSON.stringify({
      ok: result.blockReason === undefined,
      ...(result.blockReason === undefined ? {} : { message: result.blockReason }),
      ...(result.systemMessage === undefined ? {} : { context: result.systemMessage }),
    }),
  );
}

function emptyPiEvent(hook: AgentHookKind): AgentHookEvent {
  return { agent: "pi", hook, touchedPathCandidates: [] };
}
