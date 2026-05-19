#!/usr/bin/env bun

import type { ValidationPlan } from "./internal/validation-plan.ts";
import {
  GENERATED_PROJECT_CHECK_PLAN,
  GENERATED_PROJECT_VALIDATE_PLAN,
} from "./internal/validation-plan.ts";
import { executeValidationPlan } from "./internal/validation-runner.ts";

function selectedPlan(args: readonly string[]): ValidationPlan {
  const planIndex = args.indexOf("--plan");
  if (planIndex === -1) {
    return GENERATED_PROJECT_VALIDATE_PLAN;
  }

  const planName = args[planIndex + 1];
  if (planName === "check") {
    return GENERATED_PROJECT_CHECK_PLAN;
  }
  if (planName === "validate") {
    return GENERATED_PROJECT_VALIDATE_PLAN;
  }

  throw new Error(`Unknown generated validation plan: ${planName ?? ""}`);
}

if (import.meta.main) {
  await executeValidationPlan(selectedPlan(process.argv));
}
