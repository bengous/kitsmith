import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultRunCommand, localTool, repoRoot } from "./command-runner.ts";

async function seedFile(root: string, relPath: string, content: string): Promise<void> {
  const absolute = path.join(root, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

describe("generated project root resolution", () => {
  test("prefers the nested generated app root over an outer git root", async () => {
    const outer = await mkdtemp(path.join(tmpdir(), "outer-repo-"));
    const app = path.join(outer, "nested", "my-app");
    try {
      await mkdir(path.join(outer, ".git"), { recursive: true });
      await seedFile(app, ".agents/agents-md-manifest.json", "{}\n");
      await seedFile(app, "package.json", '{ "name": "my-app" }\n');
      await seedFile(app, "bunfig.toml", "\n");

      expect(repoRoot(path.join(app, "src"))).toBe(app);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });
});

describe("hook command runner", () => {
  test("reports missing local tooling as an actionable command failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kitsmith-command-runner-"));
    try {
      const result = await defaultRunCommand(
        [path.join(root, "node_modules", ".bin", "missing-hook-tool")],
        { cwd: root },
      );

      expect(result.code).toBe(127);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Hook command is unavailable: missing-hook-tool.");
      expect(result.stderr).toContain("Run `bun install` in this project");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps local tool resolution deterministic when node_modules is absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kitsmith-local-tool-"));
    try {
      expect(localTool(root, "oxlint", "linux")).toBe(
        path.join(root, "node_modules", ".bin", "oxlint"),
      );
      expect(localTool(root, "oxlint", "win32")).toBe(
        path.join(root, "node_modules", ".bin", "oxlint.cmd"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
