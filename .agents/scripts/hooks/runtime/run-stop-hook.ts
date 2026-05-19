#!/usr/bin/env bun

import type { AgentAdapter } from "../core/contract.ts";
import { runStopValidation } from "../core/stop-validation.ts";
import { printHookFailure } from "./hook-errors.ts";

export async function runStopHook(adapter: AgentAdapter): Promise<void> {
  try {
    adapter.printStopResult(await runStopValidation(await adapter.readEvent("stop")));
  } catch (error) {
    printHookFailure(adapter, "stop", error);
  }
}
