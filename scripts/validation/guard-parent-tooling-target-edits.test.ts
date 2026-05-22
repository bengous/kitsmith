import { expect, test } from "bun:test";
import {
  blockedParentToolingTargetPaths,
  parentToolingTargetEditBlockReason,
} from "./guard-parent-tooling-target-edits.ts";

test("parent tooling edit guard blocks managed sync targets", () => {
  expect(
    blockedParentToolingTargetPaths([
      ".agents/hooks/core/touched-paths.ts",
      "template-sources/ai/.agents/hooks/core/touched-paths.ts",
      ".agents/hooks/AGENTS.md",
      ".codex/config.toml",
      ".claude/settings.json",
      ".gitignore",
    ]),
  ).toEqual([".agents/hooks/core/touched-paths.ts", ".claude/settings.json"]);
});

test("parent tooling edit guard explains the source path", () => {
  const reason = parentToolingTargetEditBlockReason([".agents/hooks/core/touched-paths.ts"]);

  expect(reason).toContain("Parent tooling sync outputs must not be edited directly");
  expect(reason).toContain(".agents/hooks/core/touched-paths.ts");
  expect(reason).toContain("template-sources/ai/.agents/hooks/core/touched-paths.ts");
  expect(reason).toContain("bun run parent-tooling:sync");
});

test("parent tooling edit guard allows source edits and local preserved config blocks", () => {
  expect(
    parentToolingTargetEditBlockReason([
      "template-sources/ai/.agents/hooks/core/touched-paths.ts",
      "scripts/sync/parent-tooling/claude-settings.overlay.json",
      ".codex/config.toml",
      ".gitignore",
    ]),
  ).toBeUndefined();
});
