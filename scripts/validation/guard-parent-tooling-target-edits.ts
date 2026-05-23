#!/usr/bin/env bun

import type { AgentAdapter, AgentHookEvent } from "../../.agents/hooks/core/contract.ts";
import { claudeAdapter, parseClaudeHookInput } from "../../.agents/hooks/adapters/claude.ts";
import { codexAdapter, parseCodexHookInput } from "../../.agents/hooks/adapters/codex.ts";
import { repoRoot } from "../../.agents/hooks/core/command-runner.ts";
import { extractTouchedPaths } from "../../.agents/hooks/core/touched-paths.ts";
import { printHookFailure } from "../../.agents/hooks/runtime/hook-errors.ts";
import {
  isParentToolingDirectEditBlockedTargetPath,
  parentToolingSourceForTargetPath,
} from "../sync/parent-tooling.ts";

type ParsedPreToolHook = {
  readonly adapter: AgentAdapter;
  readonly event: AgentHookEvent;
};

export function blockedParentToolingTargetPaths(paths: readonly string[]): string[] {
  return [
    ...new Set(paths.filter((path) => isParentToolingDirectEditBlockedTargetPath(path))),
  ].toSorted();
}

export function parentToolingTargetEditBlockReason(paths: readonly string[]): string | undefined {
  const blocked = blockedParentToolingTargetPaths(paths);
  if (blocked.length === 0) {
    return undefined;
  }

  return [
    "Parent tooling sync outputs must not be edited directly:",
    ...blocked.map((path) => {
      const source = parentToolingSourceForTargetPath(path);
      return source === null ? `- ${path}` : `- ${path} (source: ${source})`;
    }),
    "",
    "Edit the source path, then run:",
    "bun run parent-tooling:sync",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeClaudeHookInput(value: unknown): boolean {
  if (process.env["CLAUDE_PROJECT_DIR"] !== undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return "tool_name" in value || "tool_use_id" in value || "transcript_path" in value;
}

function parsePreToolHookInput(value: unknown): ParsedPreToolHook {
  if (looksLikeClaudeHookInput(value)) {
    return {
      adapter: claudeAdapter,
      event: parseClaudeHookInput(value, "pre-tool"),
    };
  }

  return {
    adapter: codexAdapter,
    event: parseCodexHookInput(value, "pre-tool"),
  };
}

function fallbackAdapter(): AgentAdapter {
  return process.env["CLAUDE_PROJECT_DIR"] === undefined ? codexAdapter : claudeAdapter;
}

async function main(): Promise<void> {
  let adapter = fallbackAdapter();
  try {
    const text = await Bun.stdin.text();
    const parsed = parsePreToolHookInput(text.trim() === "" ? {} : (JSON.parse(text) as unknown));
    adapter = parsed.adapter;
    const event = parsed.event;
    const root = repoRoot(event.cwd);
    const reason = parentToolingTargetEditBlockReason(extractTouchedPaths(event, root));
    if (reason !== undefined) {
      parsed.adapter.printPreToolDeny(reason);
    }
  } catch (error) {
    printHookFailure(adapter, "pre-tool", error);
  }
}

if (import.meta.main) {
  await main();
}
