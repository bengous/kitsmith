#!/usr/bin/env bun

import { claudeAdapter } from "../../.agents/hooks/adapters/claude.ts";
import { runStopHook } from "../../.agents/hooks/runtime/run-stop-hook.ts";

await runStopHook(claudeAdapter);
