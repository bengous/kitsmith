#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/scripts/hooks/adapters/codex.ts";
import { runEditPathGuard } from "../../.agents/scripts/hooks/runtime/run-pre-tool-hook.ts";

await runEditPathGuard(codexAdapter);
