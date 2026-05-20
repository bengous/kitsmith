#!/usr/bin/env bun

import { piAdapter } from "../../.agents/scripts/hooks/adapters/pi.ts";
import { runStopHook } from "../../.agents/scripts/hooks/runtime/run-stop-hook.ts";

await runStopHook(piAdapter);
