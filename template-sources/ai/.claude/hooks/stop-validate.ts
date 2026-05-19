#!/usr/bin/env bun

import { claudeAdapter } from "../../.agents/scripts/hooks/adapters/claude.ts";
import { runStopHook } from "../../.agents/scripts/hooks/runtime/run-stop-hook.ts";

await runStopHook(claudeAdapter);
