import type { ValidationPlan } from "./validation-plan.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SPAWN_OPTS = {
  stdin: "inherit" as const,
  ...(process.platform === "win32" ? { windowsHide: true } : {}),
};

export type ValidationResult = {
  readonly step: string;
  readonly exit: number;
  readonly output: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
};

export type ValidationStepCommand = {
  readonly step: string;
  readonly command: string[];
  readonly cwd?: string;
  readonly sequence?: readonly ValidationSubcommand[];
};

type ValidationSubcommand = {
  readonly command: string[];
  readonly cwd?: string;
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

async function packageScripts(): Promise<string[]> {
  const packageJson = (await Bun.file(`${process.cwd()}/package.json`).json()) as unknown;
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

function localToolCommand(name: string, args: readonly string[]): string[] {
  return [process.execPath, "run", "--no-install", "--silent", name, ...args];
}

function pathExists(cwd: string, relativePath: string): boolean {
  return existsSync(join(cwd, relativePath));
}

type RootToolingEntry = {
  readonly lintPath: string;
  readonly archPath: string;
  readonly formatGlob: string;
};

function rootToolingEntries(cwd: string): RootToolingEntry[] {
  // If more harness hook roots are added, consider centralizing them in a small registry.
  return [
    ...(pathExists(cwd, "src")
      ? [{ lintPath: "src/", archPath: "src", formatGlob: "src/**/*.{ts,tsx,js,jsx,mjs}" }]
      : []),
    {
      lintPath: "scripts/",
      archPath: "scripts",
      formatGlob: "scripts/**/*.{ts,tsx,js,jsx,mjs}",
    },
    ...(pathExists(cwd, ".agents/scripts/hooks")
      ? [
          {
            lintPath: ".agents/scripts/hooks/",
            archPath: "./.agents/scripts/hooks",
            formatGlob: ".agents/scripts/hooks/**/*.{ts,tsx,js,jsx,mjs}",
          },
        ]
      : []),
    ...(pathExists(cwd, ".codex/hooks")
      ? [
          {
            lintPath: ".codex/hooks/",
            archPath: "./.codex/hooks",
            formatGlob: ".codex/hooks/**/*.{ts,tsx,js,jsx,mjs}",
          },
        ]
      : []),
    ...(pathExists(cwd, ".claude/hooks")
      ? [
          {
            lintPath: ".claude/hooks/",
            archPath: "./.claude/hooks",
            formatGlob: ".claude/hooks/**/*.{ts,tsx,js,jsx,mjs}",
          },
        ]
      : []),
    ...(pathExists(cwd, ".pi/hooks")
      ? [
          {
            lintPath: ".pi/hooks/",
            archPath: "./.pi/hooks",
            formatGlob: ".pi/hooks/**/*.{ts,tsx,js,jsx,mjs}",
          },
        ]
      : []),
    ...(pathExists(cwd, ".pi/extensions")
      ? [
          {
            lintPath: ".pi/extensions/",
            archPath: "./.pi/extensions",
            formatGlob: ".pi/extensions/**/*.{ts,tsx,js,jsx,mjs}",
          },
        ]
      : []),
  ];
}

function rootLintPaths(cwd: string): string[] {
  return rootToolingEntries(cwd).map((entry) => entry.lintPath);
}

function rootArchPaths(cwd: string): string[] {
  return rootToolingEntries(cwd).map((entry) => entry.archPath);
}

function rootFormatGlobs(cwd: string): string[] {
  return ["commitlint.config.js", ...rootToolingEntries(cwd).map((entry) => entry.formatGlob)];
}

function frontendStep(
  step: string,
  cwd: string,
  command: string[],
): ValidationStepCommand | undefined {
  if (!pathExists(cwd, "apps/frontend/package.json")) {
    return undefined;
  }
  return { step, command, cwd: "apps/frontend" };
}

function rootTestSubcommands(cwd: string): ValidationSubcommand[] {
  const hasAgentHookTests =
    pathExists(cwd, ".agents/scripts/hooks") ||
    pathExists(cwd, ".codex/hooks") ||
    pathExists(cwd, ".claude/hooks") ||
    pathExists(cwd, ".pi/hooks") ||
    pathExists(cwd, ".pi/extensions");

  return [
    ...(pathExists(cwd, "src") ? [{ command: [process.execPath, "test", "./src"] }] : []),
    ...(pathExists(cwd, "apps/frontend/package.json")
      ? [{ command: [process.execPath, "run", "--silent", "test"], cwd: "apps/frontend" }]
      : []),
    ...(hasAgentHookTests
      ? [
          {
            command: [
              process.execPath,
              "test",
              ...(pathExists(cwd, ".codex/hooks") ? ["./.codex/hooks"] : []),
              ...(pathExists(cwd, ".claude/hooks") ? ["./.claude/hooks"] : []),
              ...(pathExists(cwd, ".agents/scripts/hooks") ? ["./.agents/scripts/hooks"] : []),
              ...(pathExists(cwd, ".pi/hooks") ? ["./.pi/hooks"] : []),
              ...(pathExists(cwd, ".pi/extensions") ? ["./.pi/extensions"] : []),
            ],
          },
        ]
      : []),
  ];
}

const FRONTEND_STEP_COMMANDS: Record<string, (cwd: string) => string[]> = {
  "typecheck:frontend": () => [process.execPath, "run", "--silent", "typecheck"],
  "lint:frontend": () => [process.execPath, "run", "--silent", "lint"],
  "format:check:frontend": () => [process.execPath, "run", "--silent", "format:check"],
  "lint:arch:frontend": () =>
    localToolCommand("dependency-cruiser", [
      "--config",
      ".dependency-cruiser.cjs",
      "--output-type",
      "err",
      "src",
      "e2e",
      "playwright.config.ts",
      "vite.config.ts",
    ]),
  "lint:css:frontend": () => [process.execPath, "run", "--silent", "lint:css"],
  "build:frontend": () => [process.execPath, "run", "--silent", "build"],
  "test:e2e": () => [process.execPath, "run", "--no-install", "--silent", "playwright", "test"],
};

export function resolveValidationStepCommand(
  step: string,
  cwd = process.cwd(),
): ValidationStepCommand | undefined {
  const frontendCommand = FRONTEND_STEP_COMMANDS[step];
  if (frontendCommand !== undefined) {
    return frontendStep(step, cwd, frontendCommand(cwd));
  }

  switch (step) {
    case "format:check":
      return {
        step,
        command: localToolCommand("oxfmt", [
          "--check",
          "-c",
          ".oxfmtrc.jsonc",
          ...rootFormatGlobs(cwd),
        ]),
      };
    case "lint:errors":
      return {
        step,
        command: localToolCommand("oxlint", [
          "-c",
          ".oxlintrc.jsonc",
          "--quiet",
          "--format=unix",
          ...rootLintPaths(cwd),
        ]),
      };
    case "lint:arch":
      return {
        step,
        command: localToolCommand("dependency-cruiser", [
          "--config",
          ".dependency-cruiser.cjs",
          "--output-type",
          "err",
          ...rootArchPaths(cwd),
        ]),
      };
    case "typecheck":
      return {
        step,
        command: localToolCommand("tsc", ["--noEmit", "--pretty", "false"]),
      };
    case "test": {
      const sequence = rootTestSubcommands(cwd);
      if (sequence.length === 0) {
        return undefined;
      }
      const first = sequence[0]!;
      return {
        step,
        command: first.command,
        ...(first.cwd === undefined ? {} : { cwd: first.cwd }),
        sequence,
      };
    }
    case "lint:dead":
      return {
        step,
        command: localToolCommand("knip", [
          "--include",
          "files,dependencies,unlisted,binaries",
          "--reporter",
          "compact",
        ]),
      };
    case "lint:dupes":
      return { step, command: localToolCommand("jscpd", ["--config", ".jscpd.json"]) };
    case "check:links":
      return { step, command: [process.execPath, "scripts/quality/check-links-local.ts"] };
    case "lint:audit":
      return { step, command: [process.execPath, "scripts/quality/audit-oxlint-rules.ts"] };
    case "agents:check":
      return pathExists(cwd, "scripts/agents/sync-agents-md.ts")
        ? {
            step,
            command: [process.execPath, "scripts/agents/sync-agents-md.ts", "--check"],
          }
        : undefined;
    default:
      return undefined;
  }
}

function commandCwd(root: string, stepCommand: ValidationSubcommand): string {
  return stepCommand.cwd === undefined ? root : join(root, stepCommand.cwd);
}

export function runValidationStepCommand(
  stepCommand: ValidationStepCommand,
  cwd: string,
): ValidationResult {
  const startedAt = performance.now();
  const results = (stepCommand.sequence ?? [stepCommand]).map((subcommand) =>
    Bun.spawnSync(subcommand.command, {
      ...SPAWN_OPTS,
      cwd: commandCwd(cwd, subcommand),
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const failed = results.find((result) => result.exitCode !== 0);
  const stdout = results.map((result) => result.stdout.toString()).join("");
  const stderr = results.map((result) => result.stderr.toString()).join("");

  return {
    step: stepCommand.step,
    exit: failed?.exitCode ?? 0,
    output: `${stdout}${stderr}`.trimEnd(),
    stdout,
    stderr,
    ms: performance.now() - startedAt,
  };
}

export function runGeneratedValidationStep(step: string, cwd: string): ValidationResult {
  const command = resolveValidationStepCommand(step, cwd);
  if (command === undefined) {
    return {
      step,
      exit: 1,
      output: `no generated validation command is defined for ${step}`,
      stdout: "",
      stderr: `no generated validation command is defined for ${step}`,
      ms: 0,
    };
  }

  return runValidationStepCommand(command, cwd);
}

function resolveRunnableStep(
  step: string,
  availableScripts: ReadonlySet<string>,
): ValidationStepCommand | undefined {
  if (availableScripts.has(step)) {
    return { step, command: [process.execPath, "run", "--silent", step] };
  }
  return resolveValidationStepCommand(step, process.cwd());
}

function resolveRunnableSteps(
  plan: ValidationPlan,
  availableScripts: ReadonlySet<string>,
): ValidationStepCommand[] {
  return resolveSteps(plan).flatMap((step) => {
    const command = resolveRunnableStep(step, availableScripts);
    return command === undefined ? [] : [command];
  });
}

function printFail(result: ValidationResult): void {
  console.error(`FAIL ${result.step} (${formatMs(result.ms)})`);
  if (result.output.length > 0) {
    console.error(result.output);
    console.error();
  }
}

async function run(stepCommand: ValidationStepCommand): Promise<ValidationResult> {
  const startedAt = performance.now();
  const proc = Bun.spawn(stepCommand.command, {
    ...SPAWN_OPTS,
    cwd: commandCwd(process.cwd(), stepCommand),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exit] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  return {
    step: stepCommand.step,
    exit,
    output: (stdout + stderr).trimEnd(),
    stdout,
    stderr,
    ms: performance.now() - startedAt,
  };
}

async function runVerboseSequential(
  steps: readonly ValidationStepCommand[],
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const stepCommand of steps) {
    const startedAt = performance.now();
    const proc = Bun.spawn(stepCommand.command, {
      ...SPAWN_OPTS,
      cwd: commandCwd(process.cwd(), stepCommand),
      stdout: "inherit",
      stderr: "inherit",
    });
    const exit = await proc.exited;
    results.push({
      step: stepCommand.step,
      exit,
      output: "",
      stdout: "",
      stderr: "",
      ms: performance.now() - startedAt,
    });
  }
  return results;
}

async function pool(
  steps: readonly ValidationStepCommand[],
  concurrency: number,
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
    onResult(await run(step));
    return worker();
  }

  await Promise.all(Array.from({ length: width }, worker));
}

export async function executeValidationPlan(
  plan: ValidationPlan,
  args = process.argv,
): Promise<void> {
  const verbose = args.includes("--verbose");
  const jobs = parseFlag(args, "--jobs", 3);
  const availableScripts = new Set(await packageScripts());
  const steps = resolveRunnableSteps(plan, availableScripts);

  let failed = 0;
  let total = 0;

  function record(result: ValidationResult): void {
    total++;
    if (result.exit !== 0) {
      failed++;
      printFail(result);
    }
  }

  if (verbose) {
    for (const result of await runVerboseSequential(steps)) {
      record(result);
    }
  } else {
    await pool(steps, jobs, record);
  }

  if (failed === 0) {
    console.log("OK");
  } else {
    console.log(`validate: ${total - failed}/${total} passed, ${failed} failed`);
    process.exit(1);
  }
}
