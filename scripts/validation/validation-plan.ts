export type ValidationPlan = {
  readonly defaultSteps: readonly string[];
};

export type LivePushValidationPolicy = {
  readonly codeSteps: readonly string[];
  readonly productFormatStep: string;
  readonly productSteps: readonly string[];
  readonly configSteps: readonly string[];
};

export type LiveStopValidationPolicy = {
  readonly codeSteps: readonly string[];
  readonly productSteps: readonly string[];
  readonly configSteps: readonly string[];
};

export const LIVE_CHECK_PLAN: ValidationPlan = {
  defaultSteps: [
    "parent-tooling:check",
    "agents:check",
    "format:check",
    "lint:errors",
    "typecheck",
    "test",
  ],
};

export const LIVE_VALIDATE_PLAN: ValidationPlan = {
  defaultSteps: [...LIVE_CHECK_PLAN.defaultSteps, "lint:arch", "lint:audit"],
};

export const LIVE_DEEP_PLAN: ValidationPlan = {
  defaultSteps: [...LIVE_VALIDATE_PLAN.defaultSteps, "lint:dead", "lint:dupes", "check:links"],
};

export const LIVE_GENERATED_PLAN: ValidationPlan = {
  defaultSteps: ["test:project-contract"],
};

export const LIVE_SANDBOX_PLAN: ValidationPlan = {
  defaultSteps: ["test:e2e-contract", "test:safe-install", "test:smoke"],
};

export const LIVE_PUSH_VALIDATION_POLICY: LivePushValidationPolicy = {
  codeSteps: ["typecheck", "lint:errors", "format:check", "lint:arch", "test"],
  productFormatStep: "format:check",
  productSteps: ["test:project-contract"],
  configSteps: ["parent-tooling:check", "agents:check"],
};

export const LIVE_STOP_VALIDATION_POLICY: LiveStopValidationPolicy = {
  codeSteps: ["format:check", "lint:errors", "typecheck", "test"],
  productSteps: ["format:check", "test:project-contract"],
  configSteps: ["parent-tooling:check", "agents:check"],
};
