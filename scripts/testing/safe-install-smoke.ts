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
import { parseScenariosFromArgv, SCAFFOLD_SCENARIO_CONFIG } from "./scenarios.ts";

const DEFAULT_SAFE_INSTALL_SCENARIO = "tanstack-ai" satisfies ScaffoldScenario;
const DEFAULT_SAFE_INSTALL_TIMEOUT_MS = 600_000;
const SANDBOX_PROJECT = `${SANDBOX_ROOT}/project`;

export type SafeInstallOptions = {
  readonly scenario: ScaffoldScenario;
  readonly keep: boolean;
};

export function safeInstallOptionsFromArgv(argv: readonly string[]): SafeInstallOptions {
  const scenarios = parseScenariosFromArgv(argv, [DEFAULT_SAFE_INSTALL_SCENARIO]);
  const scenario = scenarios[0];
  if (scenario === undefined) {
    throw new Error("Expected one safe install smoke scenario");
  }

  return {
    scenario,
    keep: argv.includes("--keep"),
  };
}

export function safeInstallTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return sandboxTimeoutMs(env, "KITSMITH_SAFE_INSTALL_TIMEOUT_MS", DEFAULT_SAFE_INSTALL_TIMEOUT_MS);
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
  scenario: ScaffoldScenario,
  config: ScenarioConfig,
): string {
  const repoRoot = shellQuote(paths.repoRoot);
  const cliPath = shellQuote(join(paths.repoRoot, "src/index.ts"));
  const probePath = shellQuote(join(paths.repoRoot, "scripts/testing/supply-chain-probe.ts"));
  const scenarioArguments = scenarioArgs(config).map(shellQuote).join(" ");

  return [
    "set -euo pipefail",
    ...hostSecretAbsenceChecks(paths.hostHome),
    `bun run ${cliPath} ${SANDBOX_PROJECT} --yes --name ${shellQuote(
      `kitsmith-safe-${scenario}`,
    )} ${scenarioArguments} --git-init true --install true`,
    `bun run ${probePath} ${SANDBOX_PROJECT}`,
    `cd ${SANDBOX_PROJECT}`,
    "bun run check",
    "if [ -d apps/frontend ]; then bun run --cwd apps/frontend typecheck; fi",
    `cd ${repoRoot}`,
  ].join("\n");
}

export function buildSafeInstallSandboxCommand(
  paths: SandboxPaths,
  scenario: ScaffoldScenario,
  config: ScenarioConfig,
): string[] {
  return buildSandboxCommand({
    paths,
    chdir: paths.repoRoot,
    innerScript: buildInnerScript(paths, scenario, config),
    mounts: [{ kind: "read-only", source: paths.repoRoot, target: paths.repoRoot }],
  });
}

export async function safeInstallSmoke(options: SafeInstallOptions): Promise<void> {
  requireLinuxBubblewrap("safe install smoke");

  const hostSandboxRoot = await mkdtemp(
    join(tmpdir(), `kitsmith-safe-install-${options.scenario}-`),
  );
  const paths = await createSandboxPaths(hostSandboxRoot);

  try {
    await prepareSandboxRoot(hostSandboxRoot);

    console.log(`Safe install smoke sandbox: ${hostSandboxRoot}`);
    console.log(`Safe install smoke scenario: ${options.scenario}`);

    await runSandboxCommand(
      buildSafeInstallSandboxCommand(
        paths,
        options.scenario,
        SCAFFOLD_SCENARIO_CONFIG[options.scenario],
      ),
      safeInstallTimeoutMs(),
      "safe install smoke",
    );

    console.log("Safe install smoke OK");
  } finally {
    if (options.keep) {
      console.log(`Safe install smoke kept sandbox: ${hostSandboxRoot}`);
    } else {
      await rm(hostSandboxRoot, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  await safeInstallSmoke(safeInstallOptionsFromArgv(process.argv));
}
