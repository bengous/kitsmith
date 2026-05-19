export type ValidationPlan = {
  readonly defaultSteps: readonly string[];
};

export type GeneratedProjectPushValidationPolicy = {
  readonly codeSteps: readonly string[];
  readonly frontendSteps: readonly string[];
};

export const GENERATED_PROJECT_CHECK_PLAN: ValidationPlan = {
  defaultSteps: ["format:check", "lint:errors", "typecheck", "test"],
};

const GENERATED_PROJECT_FRONTEND_STEPS = [
  "typecheck:frontend",
  "lint:frontend",
  "format:check:frontend",
  "lint:arch:frontend",
  "lint:css:frontend",
  "build:frontend",
  "test:e2e",
] as const;

export const GENERATED_PROJECT_VALIDATE_PLAN: ValidationPlan = {
  defaultSteps: [
    "agents:check",
    ...GENERATED_PROJECT_CHECK_PLAN.defaultSteps,
    "lint:arch",
    "lint:dead",
    "lint:dupes",
    "check:links",
    "lint:audit",
    ...GENERATED_PROJECT_FRONTEND_STEPS,
  ],
};

export const GENERATED_PROJECT_PUSH_VALIDATION_POLICY: GeneratedProjectPushValidationPolicy = {
  codeSteps: ["typecheck", "lint:errors", "format:check", "lint:arch", "test"],
  frontendSteps: GENERATED_PROJECT_FRONTEND_STEPS,
};
