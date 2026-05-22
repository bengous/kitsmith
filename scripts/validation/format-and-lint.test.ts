import { describe, expect, test } from "bun:test";
import {
  normalizeTouchedPath as normalizeGeneratedPresetTouchedPath,
  resolveGeneratedProjectWorkspace as resolveGeneratedPresetWorkspace,
} from "../../template-sources/ai/scripts/validation/shared/quality-workspace.ts";
import {
  formatCommand,
  formatCommandFailure,
  lintCheckCommand,
  lintFixCommand,
  parseFilePath,
  parseFilePaths,
  resolveWorkspace,
} from "./format-and-lint";
import {
  hasFormattableExtension,
  hasLintableExtension,
  normalizeTouchedPath,
  resolveGeneratedProjectWorkspace,
  resolveLiveRepoWorkspace,
} from "./format-and-lint-routing.ts";
import { repoRelativePath } from "./repo-path.ts";

const generatedPresence = { backend: true, frontend: true } as const;

describe("format-and-lint hook input parsing", () => {
  test("parses single-file tool payload", () => {
    expect(parseFilePath('{"tool_input":{"file_path":"src/index.ts"}}')).toBe("src/index.ts");
  });

  test("extracts unique paths from MultiEdit payloads", () => {
    expect(
      parseFilePaths(
        '{"tool_input":{"file_path":"src/index.ts","edits":[{"file_path":"scripts/a.ts"},{"file_path":"src/index.ts"}]}}',
      ),
    ).toEqual(["src/index.ts", "scripts/a.ts"]);
  });

  test("returns no paths for malformed JSON", () => {
    expect(parseFilePaths("{")).toEqual([]);
  });
});

describe("format-and-lint failure reporting", () => {
  test("keeps command output when a quality command fails", () => {
    expect(formatCommandFailure("lint --fix", ["src/index.ts"], "", "bad lint", 1)).toBe(
      "bad lint",
    );
  });

  test("falls back to command label, paths, and exit code without command output", () => {
    expect(formatCommandFailure("format", ["src/a.ts", "src/b.ts"], "", "", 2)).toBe(
      "format: 2 files: src/a.ts, src/b.ts exited with code 2",
    );
  });
});

describe("format-and-lint command specs", () => {
  test("builds root lint, format, and lint-check commands without spawning", () => {
    const workspace = resolveLiveRepoWorkspace("scripts/validation/validate.ts");
    expect(workspace).not.toBeNull();

    expect(lintFixCommand("oxlint", workspace!, ["scripts/validation/validate.ts"])).toEqual([
      "oxlint",
      "-c",
      ".oxlintrc.jsonc",
      "--fix",
      "--quiet",
      "scripts/validation/validate.ts",
    ]);
    expect(formatCommand("oxfmt", workspace!, ["scripts/validation/validate.ts"])).toEqual([
      "oxfmt",
      "--write",
      "-c",
      ".oxfmtrc.jsonc",
      "scripts/validation/validate.ts",
    ]);
    expect(lintCheckCommand("oxlint", workspace!, ["scripts/validation/validate.ts"])).toEqual([
      "oxlint",
      "-c",
      ".oxlintrc.jsonc",
      "--quiet",
      "--format=unix",
      "scripts/validation/validate.ts",
    ]);
  });

  test("builds Codex hook check-only format command without lint-fix policy leakage", () => {
    const workspace = resolveLiveRepoWorkspace(".codex/hooks/lib.ts");
    expect(workspace?.lintFix).toBe(false);

    expect(formatCommand("oxfmt", workspace!, [".codex/hooks/lib.ts"])).toEqual([
      "oxfmt",
      "--check",
      "-c",
      ".oxfmtrc.jsonc",
      ".codex/hooks/lib.ts",
    ]);
  });
});

describe("format-and-lint workspace resolution", () => {
  test("live repo lints root code and agent hook surfaces", () => {
    expect(resolveWorkspace("src/index.ts")?.lint).toBe(true);
    expect(resolveWorkspace("scripts/validation/validate.ts")?.lint).toBe(true);
    expect(resolveWorkspace(".agents/hooks/core/contract.ts")?.lint).toBe(true);
    expect(resolveWorkspace(".codex/hooks/lib.ts")?.lint).toBe(true);
    expect(resolveWorkspace(".claude/hooks/guard-destructive.ts")?.lint).toBe(true);
  });

  test("live repo keeps Codex hook edits check-only", () => {
    const workspace = resolveLiveRepoWorkspace(".codex/hooks/lib.ts");
    expect(workspace?.name).toBe("codex-hooks");
    expect(workspace?.lint).toBe(true);
    expect(workspace?.lintFix).toBe(false);
    expect(workspace?.formatMode).toBe("check");
  });

  test("live repo formats product surfaces without root linting copied templates", () => {
    expect(resolveWorkspace("template-sources/ai/.codex/hooks/lib.ts")?.lint).toBe(false);
    expect(resolveWorkspace("templates/README.md.tpl")).toBeNull();
  });

  test("generated project routes frontend workspace separately from root tooling", () => {
    const workspace = resolveGeneratedProjectWorkspace(
      "apps/frontend/src/main.tsx",
      process.cwd(),
      generatedPresence,
    );
    expect(workspace?.name).toBe("frontend");
    expect(workspace?.oxlintConfig).toBe("apps/frontend/.oxlintrc.jsonc");
    expect(workspace?.oxlintArgs).toEqual(["--type-aware"]);
    expect(workspace?.oxfmtConfig).toBe("apps/frontend/.oxfmtrc.jsonc");
  });

  test("generated project does not route kitsmith product template surfaces", () => {
    expect(
      resolveGeneratedProjectWorkspace(
        "template-sources/ai/.codex/hooks/lib.ts",
        process.cwd(),
        generatedPresence,
      ),
    ).toBeNull();
    expect(
      resolveGeneratedProjectWorkspace(
        "templates/package.json.tpl",
        process.cwd(),
        generatedPresence,
      ),
    ).toBeNull();
  });

  test("normalizes repo-relative and absolute touched paths before routing", () => {
    expect(normalizeTouchedPath(`${process.cwd()}/scripts/validation/validate.ts`)).toBe(
      "scripts/validation/validate.ts",
    );
    expect(normalizeTouchedPath("./.claude/hooks/guard-destructive.ts")).toBe(
      ".claude/hooks/guard-destructive.ts",
    );
  });

  test("normalizes Windows absolute and relative paths before routing", () => {
    const root = String.raw`C:\repo\kitsmith`;
    expect(repoRelativePath(String.raw`C:\repo\kitsmith\src\index.ts`, root)).toBe("src/index.ts");
    expect(repoRelativePath(String.raw`src\index.ts`, root, root)).toBe("src/index.ts");
    expect(repoRelativePath(String.raw`C:\repo\other\src\index.ts`, root)).toBeNull();
    expect(
      normalizeTouchedPath(String.raw`C:\repo\kitsmith\scripts\validation\validate.ts`, root),
    ).toBe("scripts/validation/validate.ts");
    expect(
      resolveLiveRepoWorkspace(
        String.raw`C:\repo\kitsmith\template-sources\ai\.codex\hooks\lib.ts`,
        root,
      )?.name,
    ).toBe("product");
  });

  test("generated routing normalizes Windows paths before routing", () => {
    const root = String.raw`C:\repo\generated-app`;
    expect(
      normalizeGeneratedPresetTouchedPath(String.raw`C:\repo\generated-app\src\index.ts`, root),
    ).toBe("src/index.ts");
    expect(
      resolveGeneratedPresetWorkspace(
        String.raw`C:\repo\generated-app\src\index.ts`,
        root,
        generatedPresence,
      )?.name,
    ).toBe("root");
    expect(
      resolveGeneratedPresetWorkspace(
        String.raw`C:\repo\generated-app\apps\frontend\src\main.tsx`,
        root,
        generatedPresence,
      )?.name,
    ).toBe("frontend");
  });

  test("documents extension policy for lint and format routing", () => {
    expect(hasLintableExtension("src/index.ts")).toBe(true);
    expect(hasLintableExtension("config.json")).toBe(false);
    expect(hasFormattableExtension("config.json")).toBe(true);
    expect(hasFormattableExtension("templates/README.md.tpl")).toBe(false);
  });
});
