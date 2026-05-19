#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/scripts/hooks/adapters/codex.ts";
import { runStopHook } from "../../.agents/scripts/hooks/runtime/run-stop-hook.ts";

await runStopHook(codexAdapter);
