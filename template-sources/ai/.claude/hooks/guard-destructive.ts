#!/usr/bin/env bun

import { claudeAdapter } from "../../.agents/scripts/hooks/adapters/claude.ts";
import { runDestructiveCommandGuard } from "../../.agents/scripts/hooks/runtime/run-pre-tool-hook.ts";

await runDestructiveCommandGuard(claudeAdapter);
