#!/usr/bin/env bun

import { piAdapter } from "../../.agents/scripts/hooks/adapters/pi.ts";
import { runEditPathGuard } from "../../.agents/scripts/hooks/runtime/run-pre-tool-hook.ts";

await runEditPathGuard(piAdapter);
