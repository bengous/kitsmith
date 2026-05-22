#!/usr/bin/env bun

import { claudeAdapter } from "../../.agents/hooks/adapters/claude.ts";
import { runPostEditHook } from "../../.agents/hooks/runtime/run-post-edit-hook.ts";

await runPostEditHook(claudeAdapter);
