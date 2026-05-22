#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/hooks/adapters/codex.ts";
import { runEditPathGuard } from "../../.agents/hooks/runtime/run-pre-tool-hook.ts";

await runEditPathGuard(codexAdapter);
