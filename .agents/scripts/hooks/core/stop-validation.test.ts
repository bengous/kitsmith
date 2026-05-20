import type { CommandResult } from "./contract.ts";
import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultRunCommand } from "./command-runner.ts";
import { runStopValidation } from "./stop-validation.ts";
import { readTouchedPaths, recordTouchedPaths } from "./touched-paths.ts";

async function makeTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-stop-"));
  await seedFile(root, ".agents/agents-md-manifest.json", "{}\n");
  await seedFile(root, "package.json", '{ "name": "generated app" }\n');
  await seedFile(root, "bunfig.toml", "\n");
  await seedFile(root, "src/index.ts", "export const main = true;\n");
  return root;
}

async function seedFile(root: string, relPath: string, content: string): Promise<void> {
  const absolute = path.join(root, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function makeGitRoot(): Promise<string> {
  const root = await makeTestRoot();
  await runGit(root, ["init"]);
  await runGit(root, ["config", "user.email", "test@example.com"]);
  await runGit(root, ["config", "user.name", "Test User"]);
  await runGit(root, ["config", "core.filemode", "true"]);
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "-m", "Initial"]);
  return root;
}

async function runGit(root: string, args: readonly string[]): Promise<void> {
  const result = await defaultRunCommand(["git", ...args], { cwd: root });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function eventFor(root: string) {
  return {
    agent: "codex" as const,
    hook: "stop" as const,
    cwd: root,
    sessionId: "session",
    touchedPathCandidates: [],
  };
}

function mutatingRunner(mutate: () => Promise<void>) {
  return async (
    command: readonly string[],
    options: { readonly cwd: string; readonly env?: Readonly<Record<string, string | undefined>> },
  ): Promise<CommandResult> => {
    if (command[0] === "git") {
      return defaultRunCommand(command, options);
    }
    await mutate();
    return { code: 0, stdout: "", stderr: "" };
  };
}

describe("stop validation", () => {
  test("skips recursive stop hooks", async () => {
    const calls: string[] = [];
    const result = await runStopValidation(
      { agent: "codex", hook: "stop", stopHookActive: true, touchedPathCandidates: [] },
      async (command): Promise<CommandResult> => {
        calls.push(command.join(" "));
        return { code: 1, stdout: "", stderr: "" };
      },
    );

    expect(result.blockReason).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("clears pending state on success and preserves it on failure", async () => {
    const root = await makeGitRoot();
    const event = {
      agent: "claude" as const,
      hook: "stop" as const,
      cwd: root,
      sessionId: "session",
      touchedPathCandidates: [],
    };
    try {
      await recordTouchedPaths(event, ["src/index.ts"]);
      await runStopValidation(event, async (command, options) => {
        if (command[0] === "git") {
          return defaultRunCommand(command, options);
        }
        return { code: 0, stdout: "", stderr: "" };
      });
      expect(await readTouchedPaths(event)).toEqual([]);

      await recordTouchedPaths(event, ["src/index.ts"]);
      await runStopValidation(event, async (command, options) => {
        if (command[0] === "git") {
          return defaultRunCommand(command, options);
        }
        return { code: 1, stdout: "failed\n", stderr: "" };
      });
      expect(await readTouchedPaths(event)).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks generated pending paths before running validation", async () => {
    const root = await makeTestRoot();
    const calls: string[] = [];
    const event = {
      agent: "codex" as const,
      hook: "stop" as const,
      cwd: root,
      sessionId: "session",
      touchedPathCandidates: [],
    };
    try {
      await seedFile(
        root,
        ".agents/agents-md-manifest.json",
        JSON.stringify({ generated: ["AGENTS.md"], outputs: {} }),
      );
      await recordTouchedPaths(event, ["AGENTS.md"]);

      const result = await runStopValidation(event, async (command): Promise<CommandResult> => {
        calls.push(command.join(" "));
        return { code: 0, stdout: "", stderr: "" };
      });

      expect(result.blockReason).toContain(
        "Generated files must not be edited directly: AGENTS.md",
      );
      expect(calls).toEqual([]);
      expect(await readTouchedPaths(event)).toEqual(["AGENTS.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns useful failure output when validation fails", async () => {
    const root = await makeGitRoot();
    try {
      const result = await runStopValidation(
        {
          agent: "claude",
          hook: "stop",
          cwd: root,
          sessionId: "session",
          touchedPathCandidates: [],
        },
        async (command, options) => {
          if (command[0] === "git") {
            return defaultRunCommand(command, options);
          }
          return {
            code: 2,
            stdout: "Validation failed:\n[typecheck:frontend] src/routes/index.tsx failed\n",
            stderr: "lint failed\n",
          };
        },
      );

      expect(result.blockReason).toContain("Stop validation failed:");
      expect(result.blockReason).toContain("[typecheck:frontend] src/routes/index.tsx failed");
      expect(result.blockReason).toContain("lint failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks validation that mutates a file already dirty before Stop", async () => {
    const root = await makeGitRoot();
    try {
      await seedFile(root, "src/index.ts", "export const main = 'dirty before';\n");

      const result = await runStopValidation(
        eventFor(root),
        mutatingRunner(async () => {
          await seedFile(root, "src/index.ts", "export const main = 'dirty after';\n");
        }),
      );

      expect(result.blockReason).toContain("Stop validation read-only violation");
      expect(result.blockReason).toContain("src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks validation that creates an untracked file", async () => {
    const root = await makeGitRoot();
    try {
      const result = await runStopValidation(
        eventFor(root),
        mutatingRunner(async () => {
          await seedFile(root, "src/new-file.ts", "export const created = true;\n");
        }),
      );

      expect(result.blockReason).toContain("Stop validation read-only violation");
      expect(result.blockReason).toContain("src/new-file.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks validation that deletes a tracked file", async () => {
    const root = await makeGitRoot();
    try {
      const result = await runStopValidation(
        eventFor(root),
        mutatingRunner(async () => {
          await unlink(path.join(root, "src/index.ts"));
        }),
      );

      expect(result.blockReason).toContain("Stop validation read-only violation");
      expect(result.blockReason).toContain("src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks validation that mutates staged index state", async () => {
    const root = await makeGitRoot();
    try {
      const result = await runStopValidation(
        eventFor(root),
        mutatingRunner(async () => {
          await seedFile(root, "src/index.ts", "export const main = 'staged';\n");
          await runGit(root, ["add", "src/index.ts"]);
        }),
      );

      expect(result.blockReason).toContain("Stop validation read-only violation");
      expect(result.blockReason).toContain("src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks validation that changes a tracked file mode", async () => {
    const root = await makeGitRoot();
    try {
      const result = await runStopValidation(
        eventFor(root),
        mutatingRunner(async () => {
          await chmod(path.join(root, "src/index.ts"), 0o755);
        }),
      );

      expect(result.blockReason).toContain("Stop validation read-only violation");
      expect(result.blockReason).toContain("src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("passes a generated run id to validation without replacing it with session id", async () => {
    const root = await makeGitRoot();
    const validationEnvs: Array<Readonly<Record<string, string | undefined>>> = [];
    try {
      const result = await runStopValidation(
        {
          agent: "codex",
          hook: "stop",
          cwd: root,
          sessionId: "session-readable",
          touchedPathCandidates: [],
        },
        async (command, options): Promise<CommandResult> => {
          if (command[0] === "git") {
            return defaultRunCommand(command, options);
          }
          validationEnvs.push(options.env ?? {});
          return { code: 0, stdout: "", stderr: "" };
        },
      );

      expect(result.blockReason).toBeUndefined();
      expect(validationEnvs).toHaveLength(1);
      expect(validationEnvs[0]?.["KITSMITH_STOP_SESSION_ID"]).toBe("session-readable");
      expect(validationEnvs[0]?.["KITSMITH_STOP_RUN_ID"]).toBeString();
      expect(validationEnvs[0]?.["KITSMITH_STOP_RUN_ID"]).not.toBe("session-readable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks when read-only proof is unavailable after validation runs", async () => {
    const root = await makeGitRoot();
    let validationRan = false;
    try {
      const result = await runStopValidation(
        eventFor(root),
        async (command, options): Promise<CommandResult> => {
          if (command[0] !== "git") {
            validationRan = true;
            return { code: 0, stdout: "", stderr: "" };
          }
          if (validationRan && command.includes("status")) {
            return { code: 128, stdout: "", stderr: "fatal: index unavailable\n" };
          }
          return defaultRunCommand(command, options);
        },
      );

      expect(result.blockReason).toContain("Stop validation read-only proof unavailable");
      expect(result.blockReason).toContain("Git status or diff fingerprint command failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fingerprints untracked symlinks without reading their targets", async () => {
    const root = await makeGitRoot();
    const outside = path.join(root, "..", "outside-secret.txt");
    try {
      await writeFile(outside, "before\n");
      await symlink(outside, path.join(root, "secret-link"));

      const result = await runStopValidation(
        eventFor(root),
        mutatingRunner(async () => {
          await writeFile(outside, "after\n");
        }),
      );

      expect(result.blockReason).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });
});
