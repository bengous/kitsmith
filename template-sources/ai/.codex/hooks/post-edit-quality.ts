#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/hooks/adapters/codex.ts";
import { runPostEditHook } from "../../.agents/hooks/runtime/run-post-edit-hook.ts";

await runPostEditHook(codexAdapter);
