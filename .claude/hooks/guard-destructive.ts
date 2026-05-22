#!/usr/bin/env bun

import { claudeAdapter } from "../../.agents/hooks/adapters/claude.ts";
import { runDestructiveCommandGuard } from "../../.agents/hooks/runtime/run-pre-tool-hook.ts";

await runDestructiveCommandGuard(claudeAdapter);
