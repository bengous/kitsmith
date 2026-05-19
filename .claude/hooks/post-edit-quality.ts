#!/usr/bin/env bun

import { claudeAdapter } from "../../.agents/scripts/hooks/adapters/claude.ts";
import { runPostEditHook } from "../../.agents/scripts/hooks/runtime/run-post-edit-hook.ts";

await runPostEditHook(claudeAdapter);
