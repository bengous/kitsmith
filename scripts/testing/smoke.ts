#!/usr/bin/env bun

import type { SandboxPaths } from "./sandbox-runner.ts";
import type { ScaffoldScenario, ScenarioConfig } from "./scenarios.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSandboxCommand,
  createSandboxPaths,
  hostSecretAbsenceChecks,
  prepareSandboxRoot,
  requireLinuxBubblewrap,
  runSandboxCommand,
  sandboxTimeoutMs,
  SANDBOX_ROOT,
  shellQuote,
} from "./sandbox-runner.ts";
import { runWithConcurrency, scenarioJobs } from "./scenario-concurrency.ts";
import {
  ALL_SCAFFOLD_SCENARIOS,
  parseScenariosFromArgv,
  SCAFFOLD_SCENARIO_CONFIG,
} from "./scenarios.ts";

export type SmokeScenario = ScaffoldScenario;

const DEFAULT_SMOKE_TIMEOUT_MS = 900_000;
const SANDBOX_PROJECT = `${SANDBOX_ROOT}/project`;

export type SmokeOptions = {
  readonly scenarios: readonly SmokeScenario[];
  readonly keep: boolean;
  readonly jobs: number;
};

function smokePortForScenario(scenario: SmokeScenario): string {
  return String(3100 + ALL_SCAFFOLD_SCENARIOS.indexOf(scenario));
}

export function smokeScenariosFromArgv(argv: readonly string[]): SmokeScenario[] {
  return parseScenariosFromArgv(argv, ALL_SCAFFOLD_SCENARIOS);
}

export function smokeOptionsFromArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): SmokeOptions {
  return {
    scenarios: smokeScenariosFromArgv(argv),
    keep: argv.includes("--keep"),
    jobs: scenarioJobs({
      argv,
      env,
      envName: "KITSMITH_SMOKE_JOBS",
      localDefault: 3,
    }),
  };
}

export function smokeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return sandboxTimeoutMs(env, "KITSMITH_SMOKE_TIMEOUT_MS", DEFAULT_SMOKE_TIMEOUT_MS);
}

function scenarioArgs(config: ScenarioConfig): string[] {
  return [
    "--backend",
    String(config.backend),
    "--frontend",
    config.frontend,
    "--ai",
    String(config.ai),
    "--effect",
    String(config.effect),
  ];
}

function buildInnerScript(
  paths: SandboxPaths,
  scenario: SmokeScenario,
  config: ScenarioConfig,
): string {
  const cliPath = shellQuote(join(paths.repoRoot, "src/index.ts"));
  const probePath = shellQuote(join(paths.repoRoot, "scripts/testing/supply-chain-probe.ts"));
  const scenarioArguments = scenarioArgs(config).map(shellQuote).join(" ");

  return [
    "set -euo pipefail",
    ...hostSecretAbsenceChecks(paths.hostHome),
    `bun run ${cliPath} ${SANDBOX_PROJECT} --yes --name ${shellQuote(
      `kitsmith-smoke-${scenario}`,
    )} ${scenarioArguments} --git-init false --install false`,
    `cd ${SANDBOX_PROJECT}`,
    "bun install",
    `bun run ${probePath} ${SANDBOX_PROJECT}`,
    `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium PLAYWRIGHT_PORT=${shellQuote(
      smokePortForScenario(scenario),
    )} bun run validate`,
  ].join("\n");
}

export function buildSmokeSandboxCommand(
  paths: SandboxPaths,
  scenario: SmokeScenario,
  config: ScenarioConfig,
): string[] {
  return buildSandboxCommand({
    paths,
    chdir: paths.repoRoot,
    innerScript: buildInnerScript(paths, scenario, config),
    mounts: [{ kind: "read-only", source: paths.repoRoot, target: paths.repoRoot }],
    network: "enabled",
  });
}

export async function smoke(
  scenario: SmokeScenario,
  config: ScenarioConfig,
  options: { readonly keep: boolean } = { keep: false },
): Promise<void> {
  requireLinuxBubblewrap("smoke test");

  const hostSandboxRoot = await mkdtemp(join(tmpdir(), `kitsmith-smoke-${scenario}-`));
  const paths = await createSandboxPaths(hostSandboxRoot);

  try {
    await prepareSandboxRoot(hostSandboxRoot, ["project"]);

    console.log(`Smoke sandbox: ${hostSandboxRoot}`);
    console.log(`Smoke scenario: ${scenario}`);

    await runSandboxCommand(
      buildSmokeSandboxCommand(paths, scenario, config),
      smokeTimeoutMs(),
      `smoke ${scenario}`,
    );
  } finally {
    if (options.keep) {
      console.log(`Smoke kept sandbox: ${hostSandboxRoot}`);
    } else {
      await rm(hostSandboxRoot, { recursive: true, force: true });
    }
  }
}

export async function runSmoke(options: SmokeOptions): Promise<void> {
  requireLinuxBubblewrap("smoke test");
  await runWithConcurrency(options.scenarios, options.jobs, async (scenario) =>
    smoke(scenario, SCAFFOLD_SCENARIO_CONFIG[scenario], { keep: options.keep }),
  );
}

if (import.meta.main) {
  await runSmoke(smokeOptionsFromArgv(process.argv));
}
