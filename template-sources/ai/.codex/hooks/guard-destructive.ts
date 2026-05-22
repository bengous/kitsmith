#!/usr/bin/env bun

import { codexAdapter } from "../../.agents/hooks/adapters/codex.ts";
import { runDestructiveCommandGuard } from "../../.agents/hooks/runtime/run-pre-tool-hook.ts";

await runDestructiveCommandGuard(codexAdapter);
