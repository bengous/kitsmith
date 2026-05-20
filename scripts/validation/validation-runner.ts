import type { ValidationPlan } from "./validation-plan.ts";

const SPAWN_OPTS = {
  stdin: "inherit" as const,
  ...(process.platform === "win32" ? { windowsHide: true } : {}),
};

export type ValidationResult = {
  readonly step: string;
  readonly exit: number;
  readonly output: string;
  readonly ms: number;
};

export type ValidationSummary = {
  readonly total: number;
  readonly failed: number;
  readonly passed: number;
};

function parseFlag(args: readonly string[], flag: string, fallback: number): number {
  const index = args.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  const value = Number(args[index + 1]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function packageScripts(cwd = process.cwd()): Promise<string[]> {
  const packageJson = (await Bun.file(`${cwd}/package.json`).json()) as unknown;
  if (
    typeof packageJson === "object" &&
    packageJson !== null &&
    "scripts" in packageJson &&
    typeof packageJson["scripts"] === "object" &&
    packageJson["scripts"] !== null
  ) {
    return Object.keys(packageJson["scripts"]);
  }
  return [];
}

function resolveSteps(plan: ValidationPlan): string[] {
  return process.env["VALIDATE_STEPS"]?.split(",") ?? [...plan.defaultSteps];
}

function printFail(result: ValidationResult): void {
  console.error(`FAIL ${result.step} (${formatMs(result.ms)})`);
  if (result.output.length > 0) {
    console.error(result.output);
    console.error();
  }
}

export function summarizeValidationResults(
  results: readonly ValidationResult[],
): ValidationSummary {
  const failed = results.filter((result) => result.exit !== 0).length;
  return {
    total: results.length,
    failed,
    passed: results.length - failed,
  };
}

async function run(step: string, cwd = process.cwd()): Promise<ValidationResult> {
  const startedAt = performance.now();
  const proc = Bun.spawn([process.execPath, "run", "--silent", step], {
    ...SPAWN_OPTS,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exit] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  return { step, exit, output: (stdout + stderr).trimEnd(), ms: performance.now() - startedAt };
}

async function runVerboseSequential(
  steps: readonly string[],
  cwd = process.cwd(),
): Promise<ValidationResult[]> {
  return steps.reduce<Promise<ValidationResult[]>>(async (pendingResults, step) => {
    const results = await pendingResults;
    const startedAt = performance.now();
    const proc = Bun.spawn([process.execPath, "run", "--silent", step], {
      ...SPAWN_OPTS,
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exit = await proc.exited;
    return [...results, { step, exit, output: "", ms: performance.now() - startedAt }];
  }, Promise.resolve([]));
}

async function runSequential(
  steps: readonly string[],
  cwd: string,
  verbose: boolean,
): Promise<ValidationResult[]> {
  if (verbose) {
    return runVerboseSequential(steps, cwd);
  }

  return steps.reduce<Promise<ValidationResult[]>>(async (pendingResults, step) => {
    const results = await pendingResults;
    return [...results, await run(step, cwd)];
  }, Promise.resolve([]));
}

async function pool(
  steps: readonly string[],
  concurrency: number,
  cwd: string,
  onResult: (result: ValidationResult) => void,
): Promise<void> {
  let cursor = 0;
  const width = concurrency === 0 ? steps.length : Math.min(concurrency, steps.length);

  async function worker(): Promise<void> {
    const index = cursor++;
    const step = steps[index];
    if (step === undefined) {
      return;
    }
    onResult(await run(step, cwd));
    return worker();
  }

  await Promise.all(Array.from({ length: width }, worker));
}

export function validationExecutionGroups(
  plan: ValidationPlan,
  availableScripts: ReadonlySet<string>,
): {
  readonly orderedPrerequisites: readonly string[];
  readonly concurrentSteps: readonly string[];
} {
  const requestedSteps = resolveSteps(plan).filter((step) => availableScripts.has(step));
  const orderedPrerequisites =
    process.env["VALIDATE_STEPS"] === undefined
      ? (plan.orderedPrerequisites ?? []).filter((step) => availableScripts.has(step))
      : [];
  const orderedSet = new Set(orderedPrerequisites);
  return {
    orderedPrerequisites,
    concurrentSteps: requestedSteps.filter((step) => !orderedSet.has(step)),
  };
}

export async function collectValidationResults(
  plan: ValidationPlan,
  args = process.argv,
  cwd = process.cwd(),
  printFailures = true,
): Promise<ValidationResult[]> {
  const verbose = args.includes("--verbose");
  const jobs = parseFlag(args, "--jobs", 3);
  const availableScripts = new Set(await packageScripts(cwd));
  const steps = validationExecutionGroups(plan, availableScripts);

  const results: ValidationResult[] = [];

  function record(result: ValidationResult): void {
    if (printFailures && result.exit !== 0) {
      printFail(result);
    }
    results.push(result);
  }

  for (const result of await runSequential(steps.orderedPrerequisites, cwd, verbose)) {
    record(result);
  }
  if (results.some((result) => result.exit !== 0)) {
    return results;
  }

  if (verbose) {
    for (const result of await runVerboseSequential(steps.concurrentSteps, cwd)) {
      record(result);
    }
  } else {
    await pool(steps.concurrentSteps, jobs, cwd, record);
  }

  return results;
}

export async function executeValidationPlan(
  plan: ValidationPlan,
  args = process.argv,
): Promise<void> {
  const results = await collectValidationResults(plan, args);

  const summary = summarizeValidationResults(results);

  if (summary.failed === 0) {
    console.log("OK");
  } else {
    console.log(`validate: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
    process.exit(1);
  }
}
