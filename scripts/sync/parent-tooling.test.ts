import type { ParentToolingSyncRule } from "./parent-tooling";
import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyParentToolingSync,
  formatParentToolingDrift,
  isParentToolingSyncPath,
  isParentToolingSyncSourcePath,
  isParentToolingSyncTargetPath,
  mergeLineSets,
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
    expect(isParentToolingSyncPath(".gitignore")).toBe(true);
    expect(isParentToolingSyncPath("src/index.ts")).toBe(false);
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
