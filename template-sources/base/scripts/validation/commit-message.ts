#!/usr/bin/env bun

import { commitTypes } from "../../commitlint.config.js";

const messageFile = Bun.argv[2];

function printGuidance(): void {
  const guidance = `
Commit message rejected.

Use Conventional Commits with a concrete title:
  <type>(optional-scope): <imperative summary>

Allowed types:
  ${commitTypes.join(", ")}

Good examples:
  feat(generator): add commit message guardrails
  fix(cli): preserve existing commit hooks
  chore(tooling): update validation hooks

Agents: rewrite the commit message. Do not bypass this hook.
When the title does not explain the product impact, add a body that explains why.
`.trimEnd();

  console.error(guidance);
}

if (messageFile === undefined) {
  console.error("Missing commit message file path.");
  printGuidance();
  process.exit(1);
}

const commitlint =
  process.platform === "win32"
    ? "./node_modules/.bin/commitlint.cmd"
    : "./node_modules/.bin/commitlint";
const result = Bun.spawnSync([commitlint, "--edit", messageFile], {
  stdout: "pipe",
  stderr: "pipe",
});

const stdout = result.stdout.toString().trim();
const stderr = result.stderr.toString().trim();
if (stdout.length > 0) {
  console.error(stdout);
}
if (stderr.length > 0) {
  console.error(stderr);
}

if (result.exitCode !== 0) {
  printGuidance();
  process.exit(result.exitCode);
}
