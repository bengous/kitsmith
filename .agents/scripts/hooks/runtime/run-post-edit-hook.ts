#!/usr/bin/env bun

import type { AgentAdapter } from "../core/contract.ts";
import { runPostEditQuality } from "../core/post-edit-quality.ts";
import { printHookFailure } from "./hook-errors.ts";

export async function runPostEditHook(adapter: AgentAdapter): Promise<void> {
  try {
    const event = await adapter.readEvent("post-edit");
    adapter.printPostEditResult(await runPostEditQuality(event), event);
  } catch (error) {
    printHookFailure(adapter, "post-edit", error);
  }
}
