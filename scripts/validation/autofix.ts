#!/usr/bin/env bun

const SPAWN_OPTS = {
  stdin: "inherit" as const,
  stdout: "inherit" as const,
  stderr: "inherit" as const,
  ...(process.platform === "win32" ? { windowsHide: true } : {}),
};

const run = (command: string[]): void => {
  const proc = Bun.spawnSync(command, SPAWN_OPTS);
  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode);
  }
};

run([
  process.execPath,
  "run",
  "--no-install",
  "--silent",
  "oxlint",
  "-c",
  ".oxlintrc.jsonc",
  "--fix",
  "src/",
  "scripts/",
  ".claude/hooks/",
]);
run(["bun", "run", "--silent", "format"]);
