#!/usr/bin/env bun

import { piAdapter } from "../../.agents/scripts/hooks/adapters/pi.ts";
import { runPostEditHook } from "../../.agents/scripts/hooks/runtime/run-post-edit-hook.ts";

await runPostEditHook(piAdapter);
