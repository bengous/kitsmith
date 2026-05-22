import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  extractApplyPatchPaths,
  extractTouchedPaths,
  readTouchedPaths,
  recordTouchedPaths,
} from "./touched-paths.ts";

async function makeTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-hooks-"));
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

describe("hook touched paths", () => {
  test("normalizes adapter-provided paths and apply_patch paths", async () => {
    const root = await makeTestRoot();
    try {
      expect(
        extractTouchedPaths({
          agent: "codex",
          hook: "post-edit",
          cwd: root,
          touchedPathCandidates: ["src/index.ts", "../outside.ts"],
          patchText:
            "*** Begin Patch\n*** Update File: scripts/validation/validate.ts\n*** End Patch",
        }),
      ).toEqual(["scripts/validation/validate.ts", "src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("extracts apply_patch file hunks", () => {
    expect(
      extractApplyPatchPaths(`*** Begin Patch
*** Add File: src/a.ts
*** Update File: scripts/b.ts
*** Delete File: src/c.ts
*** End Patch`),
    ).toEqual(["src/a.ts", "scripts/b.ts", "src/c.ts"]);
  });

  test("Claude Stop can read pending paths recorded by a tool hook without turn ids", async () => {
    const root = await makeTestRoot();
    try {
      await recordTouchedPaths(
        {
          agent: "claude",
          hook: "post-edit",
          cwd: root,
          sessionId: "session",
          toolCallId: "toolu_123",
          touchedPathCandidates: [],
        },
        ["src/index.ts"],
      );

      expect(
        await readTouchedPaths({
          agent: "claude",
          hook: "stop",
          cwd: root,
          sessionId: "session",
          touchedPathCandidates: [],
        }),
      ).toEqual(["src/index.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
