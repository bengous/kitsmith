import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { forbiddenTouchedPaths } from "./generated-files.ts";

async function seedFile(root: string, relPath: string, content: string): Promise<void> {
  const absolute = path.join(root, relPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

describe("generated file policy", () => {
  test("blocks generated agent files from the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kitsmith-generated-files-"));
    try {
      await seedFile(
        root,
        ".agents/agents-md-manifest.json",
        JSON.stringify({
          generated: ["AGENTS.md"],
          outputs: { "docs/AGENTS.md": { sourcePath: ".claude/rules/docs.md" } },
        }),
      );

      expect(forbiddenTouchedPaths(["AGENTS.md", "docs/AGENTS.md", "src/index.ts"], root)).toEqual([
        "AGENTS.md",
        "docs/AGENTS.md",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
