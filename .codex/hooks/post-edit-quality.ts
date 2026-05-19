#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/scripts/hooks/adapters/codex.ts";
import { runPostEditHook } from "../../.agents/scripts/hooks/runtime/run-post-edit-hook.ts";

await runPostEditHook(codexAdapter);
