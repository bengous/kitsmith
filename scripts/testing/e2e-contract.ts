#!/usr/bin/env bun

import type { SandboxPaths } from "./sandbox-runner.ts";
import type { ScaffoldScenario } from "./scenarios.ts";
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
import { parseScenariosFromArgv } from "./scenarios.ts";

export type E2eContractScenario = ScaffoldScenario;

const DEFAULT_E2E_CONTRACT_SCENARIOS = [
  "none-ai",
  "none-effect",
  "tanstack-ai",
  "tanstack-ai-frontend",
  "tanstack-ai-effect",
] as const satisfies readonly E2eContractScenario[];

const DEFAULT_E2E_CONTRACT_TIMEOUT_MS = 600_000;
const SANDBOX_PROJECT = `${SANDBOX_ROOT}/project`;

export type E2eContractOptions = {
  readonly scenarios: readonly E2eContractScenario[];
  readonly keep: boolean;
  readonly jobs: number;
};

export function e2eContractScenariosFromArgv(argv: readonly string[]): E2eContractScenario[] {
  return parseScenariosFromArgv(argv, DEFAULT_E2E_CONTRACT_SCENARIOS);
}

export function e2eContractOptionsFromArgv(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): E2eContractOptions {
  return {
    scenarios: e2eContractScenariosFromArgv(argv),
    keep: argv.includes("--keep"),
    jobs: scenarioJobs({
      argv,
      env,
      envName: "KITSMITH_E2E_CONTRACT_JOBS",
      localDefault: 3,
    }),
  };
}

export function e2eContractTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return sandboxTimeoutMs(env, "KITSMITH_E2E_CONTRACT_TIMEOUT_MS", DEFAULT_E2E_CONTRACT_TIMEOUT_MS);
}

function buildInnerScript(paths: SandboxPaths, scenario: E2eContractScenario): string {
  const scenarioRunner = shellQuote(
    join(paths.repoRoot, "scripts/testing/e2e-contract-scenario.ts"),
  );

  return [
    "set -euo pipefail",
    ...hostSecretAbsenceChecks(paths.hostHome),
    `bun run ${scenarioRunner} --scenario ${shellQuote(scenario)} --project-dir ${shellQuote(
      SANDBOX_PROJECT,
    )}`,
  ].join("\n");
}

export function buildE2eContractSandboxCommand(
  paths: SandboxPaths,
  scenario: E2eContractScenario,
): string[] {
  return buildSandboxCommand({
    paths,
    chdir: paths.repoRoot,
    innerScript: buildInnerScript(paths, scenario),
    mounts: [{ kind: "read-only", source: paths.repoRoot, target: paths.repoRoot }],
    network: "enabled",
  });
}

export async function e2eContract(
  scenario: E2eContractScenario,
  options: { readonly keep: boolean } = { keep: false },
): Promise<void> {
  requireLinuxBubblewrap("e2e contract");

  const hostSandboxRoot = await mkdtemp(join(tmpdir(), `kitsmith-e2e-contract-${scenario}-`));
  const paths = await createSandboxPaths(hostSandboxRoot);

  try {
    await prepareSandboxRoot(hostSandboxRoot, ["project"]);

    console.log(`E2E contract sandbox: ${hostSandboxRoot}`);
    console.log(`E2E contract scenario: ${scenario}`);

    await runSandboxCommand(
      buildE2eContractSandboxCommand(paths, scenario),
      e2eContractTimeoutMs(),
      `e2e contract ${scenario}`,
    );
  } finally {
    if (options.keep) {
      console.log(`E2E contract kept sandbox: ${hostSandboxRoot}`);
    } else {
      await rm(hostSandboxRoot, { recursive: true, force: true });
    }
  }
}

export async function runE2eContract(options: E2eContractOptions): Promise<void> {
  requireLinuxBubblewrap("e2e contract");
  await runWithConcurrency(options.scenarios, options.jobs, async (scenario) =>
    e2eContract(scenario, { keep: options.keep }),
  );
}

if (import.meta.main) {
  await runE2eContract(e2eContractOptionsFromArgv(process.argv));
}
