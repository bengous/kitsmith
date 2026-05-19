import { describe, expect, test } from "bun:test";
import {
  BLOCKED_PATTERNS,
  MERGE_HINT,
  checkCommand,
  checkMergeGuard,
  checkRm,
  stripStringLiterals,
} from "./destructive-command.ts";

describe("destructive command guard core", () => {
  test("blocks recursive forced rm in any flag order", () => {
    expect(checkRm(["rm", "-rf", "dist"])).toBe("rm recursive + force");
    expect(checkRm(["rm", "-fr", "dist"])).toBe("rm recursive + force");
    expect(checkRm(["rm", "--force", "--recursive", "dist"])).toBe("rm recursive + force");
    expect(checkCommand("rm -r /tmp/example")).toBe("rm recursive on absolute path");
  });

  test("blocks known destructive git commands", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["git push --force-with-lease", "git push --force-with-lease"],
      ["git push --force", "git push --force"],
      ["git push -f", "git push -f"],
      ["git reset --hard HEAD", "git reset --hard"],
      ["git clean -fd", "git clean -f"],
      ["git checkout .", "git checkout ."],
      ["git checkout -- .", "git checkout -- ."],
      ["git restore .", "git restore ."],
      ["git branch -D feature/example", "git branch -D"],
      ["git stash drop", "git stash drop"],
      ["git stash clear", "git stash clear"],
    ];

    for (const [command, expected] of cases) {
      expect(checkCommand(command)).toBe(expected);
    }
  });

  test("blocks destructive commands passed through shell interpreters", () => {
    expect(checkCommand("bash -lc 'git reset --hard HEAD'")).toBe("git reset --hard");
    expect(checkCommand('sh -c "rm -rf dist"')).toBe("rm recursive + force");
    expect(checkCommand("/bin/zsh -c 'git push --force'")).toBe("git push --force");
  });

  test("blocks non fast-forward merge", () => {
    expect(checkMergeGuard("git merge feature/test")).toBe(MERGE_HINT);
    expect(checkMergeGuard("git merge --ff-only feature/test")).toBeNull();
    expect(checkCommand("bash -lc 'git merge feature/test'")).toBe(MERGE_HINT);
  });

  test("ignores destructive text inside string literals and heredocs", () => {
    expect(checkCommand("printf 'git reset --hard HEAD'")).toBeNull();
    expect(checkCommand('echo "rm -rf /tmp/example"')).toBeNull();
    expect(checkCommand("cat <<'EOF'\ngit reset --hard HEAD\nEOF")).toBeNull();
  });

  test("strips quoted strings before matching", () => {
    expect(stripStringLiterals("git commit -m 'rm -rf dist'")).toBe("git commit -m ''");
  });

  test("exposes the blocked pattern table", () => {
    expect(BLOCKED_PATTERNS.map(([, label]) => label)).toContain("git push --force");
  });
});
