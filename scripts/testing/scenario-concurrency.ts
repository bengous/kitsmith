export type ScenarioJobOptions = {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly envName: string;
  readonly localDefault: number;
};

export function scenarioJobs(options: ScenarioJobOptions): number {
  const flag = options.argv.indexOf("--jobs");
  const raw =
    flag === -1
      ? (options.env[options.envName] ?? (options.env["CI"] === "true" ? "1" : undefined))
      : options.argv[flag + 1];

  if (raw === undefined) {
    return options.localDefault;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Expected ${flag === -1 ? options.envName : "--jobs"} to be a positive integer`,
    );
  }
  return parsed;
}

export async function runWithConcurrency<T>(
  values: readonly T[],
  jobs: number,
  run: (value: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(jobs) || jobs <= 0) {
    throw new Error("Expected jobs to be a positive integer");
  }

  const queue = [...values];

  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) {
        return;
      }
      await run(next);
    }
  }

  await Promise.all(Array.from({ length: Math.min(jobs, values.length) }, worker));
}
