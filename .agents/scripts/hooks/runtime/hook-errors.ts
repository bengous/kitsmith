import type { AgentAdapter, AgentHookEvent, AgentHookKind } from "../core/contract.ts";

type HumanReadableHookLabel = "Pre-tool" | "Post-edit" | "Stop";

const HUMAN_READABLE_HOOK_LABEL_BY_KIND = {
  "pre-tool": "Pre-tool",
  "post-edit": "Post-edit",
  stop: "Stop",
} as const satisfies Record<AgentHookKind, HumanReadableHookLabel>;

export function printHookFailure(adapter: AgentAdapter, hook: AgentHookKind, error: unknown): void {
  const blockReason = hookFailureReason(hook, error);

  if (hook === "pre-tool") {
    adapter.printPreToolDeny(blockReason);
    return;
  }

  if (hook === "post-edit") {
    adapter.printPostEditResult({ blockReason }, fallbackEvent(adapter.agent, hook));
    return;
  }

  adapter.printStopResult({ blockReason });
}

export function hookFailureReason(hook: AgentHookKind, error: unknown): string {
  return [
    `${humanReadableHookLabel(hook)} hook failed before validation could complete.`,
    `Error: ${errorMessage(error)}`,
    actionFor(error),
  ].join("\n");
}

function humanReadableHookLabel(hook: AgentHookKind): HumanReadableHookLabel {
  return HUMAN_READABLE_HOOK_LABEL_BY_KIND[hook];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function actionFor(error: unknown): string {
  if (error instanceof SyntaxError) {
    return "Check that the hook payload is valid JSON, then retry the agent action.";
  }

  return "Check the hook configuration and project dependencies, then retry the agent action.";
}

function fallbackEvent(agent: string, hook: AgentHookKind): AgentHookEvent {
  return { agent, hook, touchedPathCandidates: [] };
}
