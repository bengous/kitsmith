import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

export const SANDBOX_ROOT = "/sandbox";
export const SANDBOX_HOME = `${SANDBOX_ROOT}/home`;
export const DEFAULT_SANDBOX_TIMEOUT_MS = 600_000;

const timedOut = Symbol("timedOut");

const STRICT_SANDBOX_ENV_KEYS = new Set([
  "BUN_INSTALL",
  "BUN_INSTALL_CACHE_DIR",
  "BUN_TMPDIR",
  "GIT_CONFIG_GLOBAL",
  "HOME",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_USERCONFIG",
  "PATH",
  "PLAYWRIGHT_BROWSERS_PATH",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "npm_config_cache",
  "npm_config_userconfig",
]);

export const DEFAULT_HOST_SECRET_RELATIVE_PATHS = [
  ".npmrc",
  ".netrc",
  ".ssh",
  ".aws",
  ".azure",
  ".config/gh",
  ".config/gcloud",
  ".kube",
] as const;

export type SandboxNetworkMode = "enabled" | "none";

export type SandboxMount = {
  readonly kind: "read-only" | "read-write";
  readonly source: string;
  readonly target: string;
};

export type SandboxPaths = {
  readonly repoRoot: string;
  readonly bunBinary: string;
  readonly hostSandboxRoot: string;
  readonly hostHome: string;
};

export type BuildSandboxCommandOptions = {
  readonly paths: SandboxPaths;
  readonly innerScript: string;
  readonly chdir: string;
  readonly mounts: readonly SandboxMount[];
  readonly env?: Readonly<Record<string, string>>;
  readonly network?: SandboxNetworkMode;
};

export function sandboxTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  envName = "KITSMITH_SANDBOX_TIMEOUT_MS",
  defaultMs = DEFAULT_SANDBOX_TIMEOUT_MS,
): number {
  const raw = env[envName];
  if (raw === undefined) {
    return defaultMs;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultMs;
}

export function buildSandboxEnv(
  bunBinary: string = process.execPath,
  extraEnv: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  for (const key of Object.keys(extraEnv)) {
    if (STRICT_SANDBOX_ENV_KEYS.has(key)) {
      throw new Error(`Sandbox env override is not allowed for ${key}`);
    }
  }

  return {
    BUN_INSTALL: `${SANDBOX_HOME}/.bun`,
    BUN_INSTALL_CACHE_DIR: `${SANDBOX_ROOT}/bun-cache`,
    BUN_TMPDIR: `${SANDBOX_ROOT}/tmp`,
    CI: "1",
    GIT_CONFIG_GLOBAL: `${SANDBOX_HOME}/.gitconfig`,
    HOME: SANDBOX_HOME,
    NO_COLOR: "1",
    NPM_CONFIG_CACHE: `${SANDBOX_ROOT}/npm-cache`,
    NPM_CONFIG_USERCONFIG: `${SANDBOX_HOME}/.npmrc`,
    PATH: `${dirname(bunBinary)}:/usr/bin:/bin`,
    PLAYWRIGHT_BROWSERS_PATH: `${SANDBOX_ROOT}/playwright-browsers`,
    TMPDIR: `${SANDBOX_ROOT}/tmp`,
    XDG_CACHE_HOME: `${SANDBOX_HOME}/.cache`,
    XDG_CONFIG_HOME: `${SANDBOX_HOME}/.config`,
    XDG_DATA_HOME: `${SANDBOX_HOME}/.local/share`,
    npm_config_cache: `${SANDBOX_ROOT}/npm-cache`,
    npm_config_userconfig: `${SANDBOX_HOME}/.npmrc`,
    ...extraEnv,
  };
}

export function hostHomeFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"];
  if (home === undefined || !home.startsWith("/")) {
    throw new Error("sandbox runner requires an absolute HOME path");
  }
  return home;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function hostSecretAbsenceChecks(
  hostHome: string,
  relativePaths: readonly string[] = DEFAULT_HOST_SECRET_RELATIVE_PATHS,
): string[] {
  return relativePaths.map((relativePath) => {
    const operator = relativePath.includes(".") && !relativePath.endsWith("rc") ? "-d" : "-e";
    return `test ! ${operator} ${shellQuote(posix.join(hostHome, relativePath))}`;
  });
}

function parentDirectories(path: string): string[] {
  const parents: string[] = [];
  let current = posix.dirname(path);

  while (current !== "/" && !parents.includes(current)) {
    parents.unshift(current);
    current = posix.dirname(current);
  }

  return parents;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function envAssignments(env: Readonly<Record<string, string>>): string[] {
  return Object.entries(env)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
}

function mountParentDirs(options: BuildSandboxCommandOptions): string[] {
  return unique([
    ...parentDirectories(options.paths.bunBinary),
    ...parentDirectories(options.paths.hostHome),
    options.paths.hostHome,
    ...parentDirectories(options.chdir),
    ...options.mounts.flatMap((mount) => parentDirectories(mount.target)),
  ]).filter((path) => path !== SANDBOX_ROOT);
}

function pushHostRootPath(command: string[], path: string): void {
  if (!existsSync(path)) {
    return;
  }

  if (lstatSync(path).isSymbolicLink()) {
    command.push("--symlink", readlinkSync(path), path);
    return;
  }

  command.push("--ro-bind", path, path);
}

export function buildSandboxCommand(options: BuildSandboxCommandOptions): string[] {
  const command = [
    "bwrap",
    "--die-with-parent",
    ...(options.network === "none" ? ["--unshare-net"] : []),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--dir",
    "/tmp",
    "--dir",
    SANDBOX_ROOT,
    "--bind",
    options.paths.hostSandboxRoot,
    SANDBOX_ROOT,
    "--dir",
    "/usr",
    "--ro-bind",
    "/usr",
    "/usr",
    "--dir",
    "/etc",
    "--ro-bind",
    "/etc",
    "/etc",
  ];

  pushHostRootPath(command, "/bin");
  pushHostRootPath(command, "/lib");
  pushHostRootPath(command, "/lib64");

  if (existsSync("/run/systemd/resolve")) {
    command.push("--dir", "/run", "--dir", "/run/systemd", "--ro-bind", "/run/systemd/resolve");
    command.push("/run/systemd/resolve");
  }

  for (const parent of mountParentDirs(options)) {
    command.push("--dir", parent);
  }

  command.push("--ro-bind", options.paths.bunBinary, options.paths.bunBinary);

  for (const mount of options.mounts) {
    command.push(mount.kind === "read-only" ? "--ro-bind" : "--bind", mount.source, mount.target);
  }

  command.push(
    "--chdir",
    options.chdir,
    "/usr/bin/env",
    "-i",
    ...envAssignments(buildSandboxEnv(options.paths.bunBinary, options.env)),
    "bash",
    "-lc",
    options.innerScript,
  );

  return command;
}

export async function createSandboxPaths(
  hostSandboxRoot: string,
  cwd = process.cwd(),
  execPath = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SandboxPaths> {
  return {
    repoRoot: await realpath(cwd),
    bunBinary: await realpath(execPath),
    hostSandboxRoot,
    hostHome: await realpath(hostHomeFromEnv(env)),
  };
}

export async function prepareSandboxRoot(
  hostSandboxRoot: string,
  extraDirs: readonly string[] = [],
): Promise<void> {
  await Promise.all(
    ["bun-cache", "home", "npm-cache", "playwright-browsers", "tmp", ...extraDirs].map(
      async (path) => mkdir(join(hostSandboxRoot, path), { recursive: true }),
    ),
  );
}

export function requireLinuxBubblewrap(label = "sandbox runner"): void {
  if (process.platform !== "linux") {
    throw new Error(`${label} requires Linux bubblewrap sandboxing`);
  }
  if (!existsSync("/usr/bin/bwrap")) {
    throw new Error(`${label} requires /usr/bin/bwrap`);
  }
}

export async function runSandboxCommand(
  command: readonly string[],
  timeoutMs: number,
  label = "sandbox command",
): Promise<void> {
  const proc = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: { PATH: "/usr/bin:/bin" },
  });

  let timer: NodeJS.Timeout;
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => {
      proc.kill();
      resolve(timedOut);
    }, timeoutMs);
    timer.unref();
  });

  const exitCode = await Promise.race([proc.exited, timeout]);
  clearTimeout(timer!);

  if (exitCode === timedOut) {
    throw new Error(`${label} timed out after ${timeoutMs}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}
