#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/hooks/adapters/codex.ts";
import { runStopHook } from "../../.agents/hooks/runtime/run-stop-hook.ts";

await runStopHook(codexAdapter);
