#!/usr/bin/env bun

import type { AgentAdapter } from "../core/contract.ts";
import { repoRoot } from "../core/command-runner.ts";
import { checkCommand, checkMergeGuard } from "../core/destructive-command.ts";
import { forbiddenTouchedPaths, generatedPathMessage } from "../core/generated-files.ts";
import { extractTouchedPaths, recordTouchedPaths } from "../core/touched-paths.ts";
import { printHookFailure } from "./hook-errors.ts";

export async function runDestructiveCommandGuard(adapter: AgentAdapter): Promise<void> {
  try {
    const event = await adapter.readEvent("pre-tool");
    if (event.toolCommand === undefined) {
      return;
    }

    const match = checkCommand(event.toolCommand) ?? checkMergeGuard(event.toolCommand);
    if (match !== null) {
      adapter.printPreToolDeny(
        `Destructive command blocked: ${match}\nCommand: ${event.toolCommand}`,
      );
    }
  } catch (error) {
    printHookFailure(adapter, "pre-tool", error);
  }
}

export async function runEditPathGuard(adapter: AgentAdapter): Promise<void> {
  try {
    const event = await adapter.readEvent("pre-tool");
    const root = repoRoot(event.cwd);
    const paths = extractTouchedPaths(event, root);
    const forbidden = forbiddenTouchedPaths(paths, root);

    if (forbidden.length > 0) {
      adapter.printPreToolDeny(generatedPathMessage(forbidden));
      return;
    }

    await recordTouchedPaths(event, paths);
  } catch (error) {
    printHookFailure(adapter, "pre-tool", error);
  }
}
