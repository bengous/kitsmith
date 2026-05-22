import type { ParentToolingSyncRule } from "./parent-tooling";
import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyParentToolingSync,
  formatParentToolingDrift,
  isParentToolingDirectEditBlockedTargetPath,
  isParentToolingSyncPath,
  isParentToolingSyncSourcePath,
  isParentToolingSyncTargetPath,
  mergeLineSets,
  parentToolingSourceForTargetPath,
  planParentToolingSync,
} from "./parent-tooling";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kitsmith-parent-tooling-"));
  tempDirs.push(dir);
  return dir;
}

function canCreateSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "kitsmith-parent-tooling-symlink-"));
  try {
    writeFileSync(join(dir, "target.txt"), "target\n");
    symlinkSync("target.txt", join(dir, "link.txt"), "file");
    return lstatSync(join(dir, "link.txt")).isSymbolicLink();
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function writeFile(root: string, path: string, content: string): Promise<void> {
  await Bun.write(join(root, path), content);
}

async function expectRejectsWithMessage(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    expect(error.message).toContain(expectedMessage);
    return;
  }
  throw new Error("Expected promise to reject");
}

describe("parent tooling line merges", () => {
  test("adds generated-project lines without dropping parent-local ignores", () => {
    expect(mergeLineSets("dist/\nnode_modules\n", "node_modules\n.DS_Store\n")).toBe(
      "dist/\nnode_modules\n.DS_Store\n",
    );
  });
});

describe("parent tooling sync plan", () => {
  test("classifies managed source and target paths without claiming preserved extras", () => {
    expect(isParentToolingSyncSourcePath("template-sources/ai/.codex/hooks/guard.ts")).toBe(true);
    expect(isParentToolingSyncTargetPath(".codex/hooks/guard.ts")).toBe(true);
    expect(isParentToolingSyncTargetPath(".codex/hooks/AGENTS.md")).toBe(false);
    expect(isParentToolingDirectEditBlockedTargetPath(".agents/hooks/core/contract.ts")).toBe(true);
    expect(isParentToolingDirectEditBlockedTargetPath(".codex/config.toml")).toBe(false);
    expect(isParentToolingDirectEditBlockedTargetPath(".claude/settings.json")).toBe(true);
    expect(isParentToolingDirectEditBlockedTargetPath(".gitignore")).toBe(false);
    expect(
      isParentToolingSyncSourcePath("scripts/sync/parent-tooling/claude-settings.overlay.json"),
    ).toBe(true);
    expect(isParentToolingSyncPath(".gitignore")).toBe(true);
    expect(isParentToolingSyncPath("src/index.ts")).toBe(false);
    expect(parentToolingSourceForTargetPath(".agents/hooks/core/contract.ts")).toBe(
      "template-sources/ai/.agents/hooks/core/contract.ts",
    );
    expect(parentToolingSourceForTargetPath(".claude/settings.json")).toBe(
      "template-sources/ai/.claude/settings.json, scripts/sync/parent-tooling/claude-settings.overlay.json",
    );
  });

  test("replaces managed trees, preserves declared extras, and removes stale files", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/hooks/a.ts", "new a\n");
    await writeFile(dir, "source/hooks/nested/b.ts", "new b\n");
    await writeFile(dir, "target/hooks/a.ts", "old a\n");
    await writeFile(dir, "target/hooks/AGENTS.md", "generated guidance\n");
    await writeFile(dir, "target/hooks/stale.ts", "old stale\n");
    const rules = [
      {
        name: "test hooks",
        mode: "replace-tree",
        source: "source/hooks",
        target: "target/hooks",
        preserveExtra: ["AGENTS.md"],
      },
    ] satisfies readonly ParentToolingSyncRule[];

    const plan = await planParentToolingSync({ cwd: dir, rules });

    expect(plan.changes.map((change) => `${change.kind}:${change.path}`)).toEqual([
      "write:target/hooks/a.ts",
      "write:target/hooks/nested/b.ts",
      "remove:target/hooks/stale.ts",
    ]);
    expect(formatParentToolingDrift(plan.changes).join("\n")).toContain(
      "target/hooks/stale.ts: stale managed file",
    );
  });

  test("write mode makes the same rules pass check mode", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/.gitignore", "node_modules\n.DS_Store\n");
    await writeFile(dir, "target/.gitignore", "dist/\nnode_modules\n");
    const rules = [
      {
        name: "test gitignore",
        mode: "merge-lines",
        source: "source/.gitignore",
        target: "target/.gitignore",
      },
    ] satisfies readonly ParentToolingSyncRule[];

    const plan = await planParentToolingSync({ cwd: dir, rules });
    expect(plan.changes).toHaveLength(1);
    await applyParentToolingSync(plan.changes, dir);

    expect(await Bun.file(join(dir, "target/.gitignore")).text()).toBe(
      "dist/\nnode_modules\n.DS_Store\n",
    );
    expect((await planParentToolingSync({ cwd: dir, rules })).changes).toHaveLength(0);
  });

  test("replace-file rules can preserve parent-local marked blocks", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/config.toml", "managed = true\n");
    await writeFile(
      dir,
      "target/config.toml",
      ["managed = false", "", "# BEGIN LOCAL", "local = true", "# END LOCAL", ""].join("\n"),
    );
    const rules = [
      {
        name: "test config",
        mode: "replace-file",
        source: "source/config.toml",
        target: "target/config.toml",
        preserveBlocks: [{ start: "# BEGIN LOCAL", end: "# END LOCAL" }],
      },
    ] satisfies readonly ParentToolingSyncRule[];

    const plan = await planParentToolingSync({ cwd: dir, rules });

    expect(plan.changes).toEqual([
      {
        kind: "write",
        path: "target/config.toml",
        reason: "test config",
        content: "managed = true\n\n# BEGIN LOCAL\nlocal = true\n# END LOCAL\n",
      },
    ]);
    await applyParentToolingSync(plan.changes, dir);
    expect((await planParentToolingSync({ cwd: dir, rules })).changes).toHaveLength(0);
  });

  test("replace-file rules can apply parent-local JSON overlays", async () => {
    const dir = makeTempDir();
    await writeFile(
      dir,
      "source/settings.json",
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "bun guard-destructive.ts" }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      dir,
      "overlay/settings.json",
      `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "Edit|Write|MultiEdit",
                hooks: [
                  {
                    type: "command",
                    command: "bun scripts/validation/guard-parent-tooling-target-edits.ts",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      dir,
      "target/settings.json",
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "bun old-guard.ts" }],
            },
          ],
        },
      }),
    );
    const rules = [
      {
        name: "test settings",
        mode: "replace-file",
        source: "source/settings.json",
        target: "target/settings.json",
        jsonOverlays: ["overlay/settings.json"],
      },
    ] satisfies readonly ParentToolingSyncRule[];

    const plan = await planParentToolingSync({ cwd: dir, rules });

    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0];
    if (change?.kind !== "write") {
      throw new Error("Expected a write change");
    }
    expect(change.content).toContain("bun guard-destructive.ts");
    expect(change.content).toContain("scripts/validation/guard-parent-tooling-target-edits.ts");
    expect(change.content).not.toContain("bun old-guard.ts");
    await applyParentToolingSync(plan.changes, dir);
    expect((await planParentToolingSync({ cwd: dir, rules })).changes).toHaveLength(0);
  });

  test("replace-file rules reject malformed preserved blocks", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/config.toml", "managed = true\n");
    await writeFile(dir, "target/config.toml", "# BEGIN LOCAL\nlocal = true\n");
    const rules = [
      {
        name: "test config",
        mode: "replace-file",
        source: "source/config.toml",
        target: "target/config.toml",
        preserveBlocks: [{ start: "# BEGIN LOCAL", end: "# END LOCAL" }],
      },
    ] satisfies readonly ParentToolingSyncRule[];

    await expectRejectsWithMessage(
      async () => planParentToolingSync({ cwd: dir, rules }),
      "preserved block markers must appear exactly once",
    );
  });

  test("replace-file rules reject malformed JSON overlays", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/settings.json", '{"hooks":{"PreToolUse":[]}}\n');
    await writeFile(dir, "overlay/settings.json", "[1, 2]\n");
    await writeFile(dir, "target/settings.json", '{"hooks":{"PreToolUse":[]}}\n');
    const rules = [
      {
        name: "test settings",
        mode: "replace-file",
        source: "source/settings.json",
        target: "target/settings.json",
        jsonOverlays: ["overlay/settings.json"],
      },
    ] satisfies readonly ParentToolingSyncRule[];

    await expectRejectsWithMessage(
      async () => planParentToolingSync({ cwd: dir, rules }),
      "overlay/settings.json: expected a JSON object",
    );
  });

  test.if(canCreateSymlinks())("check mode rejects symlinked managed targets", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/config.toml", "managed\n");
    await writeFile(dir, "outside.toml", "outside\n");
    symlinkSync(join(dir, "outside.toml"), join(dir, "target.toml"), "file");
    const rules = [
      {
        name: "test config",
        mode: "replace-file",
        source: "source/config.toml",
        target: "target.toml",
      },
    ] satisfies readonly ParentToolingSyncRule[];

    await expectRejectsWithMessage(
      async () => planParentToolingSync({ cwd: dir, rules }),
      "symlinks are not allowed",
    );
  });

  test.if(canCreateSymlinks())("check mode rejects symlinked managed sources", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "outside.toml", "outside\n");
    await writeFile(dir, "target.toml", "managed\n");
    symlinkSync(join(dir, "outside.toml"), join(dir, "source.toml"), "file");
    const rules = [
      {
        name: "test config",
        mode: "replace-file",
        source: "source.toml",
        target: "target.toml",
      },
    ] satisfies readonly ParentToolingSyncRule[];

    await expectRejectsWithMessage(
      async () => planParentToolingSync({ cwd: dir, rules }),
      "symlinks are not allowed",
    );
  });

  test.if(canCreateSymlinks())("write mode rejects symlinked managed targets", async () => {
    const dir = makeTempDir();
    await writeFile(dir, "source/config.toml", "managed\n");
    await writeFile(dir, "outside.toml", "outside\n");
    const rules = [
      {
        name: "test config",
        mode: "replace-file",
        source: "source/config.toml",
        target: "target.toml",
      },
    ] satisfies readonly ParentToolingSyncRule[];

    const plan = await planParentToolingSync({ cwd: dir, rules });
    symlinkSync(join(dir, "outside.toml"), join(dir, "target.toml"), "file");

    await expectRejectsWithMessage(
      async () => applyParentToolingSync(plan.changes, dir),
      "symlinks are not allowed",
    );
    expect(await Bun.file(join(dir, "outside.toml")).text()).toBe("outside\n");
  });
});
