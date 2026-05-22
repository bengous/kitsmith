import type { CommandResult, CommandRunnerOptions } from "./contract.ts";
import { existsSync } from "node:fs";
import path from "node:path";

export async function defaultRunCommand(
  command: readonly string[],
  options: CommandRunnerOptions,
): Promise<CommandResult> {
  try {
    const proc = Bun.spawn([...command], {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    return commandSpawnFailure(command, error);
  }
}

export function repoRoot(cwd = process.cwd()): string {
  const resolvedCwd = path.resolve(cwd);
  const root = findNearestGeneratedProjectRoot(resolvedCwd);
  return root ?? resolvedCwd;
}

export function findNearestGeneratedProjectRoot(start: string): string | null {
  let current = path.resolve(start);
  while (true) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, "bunfig.toml")) &&
      existsSync(path.join(current, ".agents", "agents-md-manifest.json"))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function localTool(
  root: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const candidates = platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const candidate of candidates) {
    const local = path.join(root, "node_modules", ".bin", candidate);
    if (existsSync(local)) {
      return local;
    }
  }
  return path.join(root, "node_modules", ".bin", candidates[0] ?? name);
}

export function commandOutput(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

export function tail(text: string, lines: number): string {
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

function commandSpawnFailure(command: readonly string[], error: unknown): CommandResult {
  const code = errorCode(error) === "ENOENT" ? 127 : 1;
  return {
    code,
    stdout: "",
    stderr: code === 127 ? missingCommandMessage(command[0]) : spawnErrorMessage(command, error),
  };
}

function missingCommandMessage(executable: string | undefined): string {
  const name = executableName(executable);
  const action =
    name === "bun"
      ? "Ensure Bun is available on PATH for hook execution, then retry the agent action."
      : "Run `bun install` in this project, then retry the agent action.";

  return [`Hook command is unavailable: ${name}.`, action].join("\n");
}

function spawnErrorMessage(command: readonly string[], error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [`Hook command failed before it could run: ${command.join(" ")}`, detail].join("\n");
}

function executableName(executable: string | undefined): string {
  if (executable === undefined || executable.trim() === "") {
    return "unknown";
  }

  return path.basename(executable).replace(/\.(cmd|exe)$/i, "");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
