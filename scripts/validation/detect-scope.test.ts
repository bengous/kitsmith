import { describe, expect, test } from "bun:test";
import {
  classifyFile,
  classifyFileWithWorkspace,
  classifyScopes,
  CODE_PATTERN,
  expandConfigScopeWithWorkspace,
} from "./detect-scope.ts";

describe("classifyFileWithWorkspace", () => {
  test("classifies backend, scripts, config, and frontend paths", () => {
    const presence = { backend: true, frontend: true };
    expect(classifyFileWithWorkspace("src/index.ts", presence)).toBe("backend");
    expect(classifyFileWithWorkspace("scripts/setup/bootstrap.ts", presence)).toBe("scripts");
    expect(classifyFileWithWorkspace(".codex/hooks/post-edit-quality.ts", presence)).toBe(
      "scripts",
    );
    expect(classifyFileWithWorkspace(".agents/scripts/hooks/core/contract.ts", presence)).toBe(
      "scripts",
    );
    expect(classifyFileWithWorkspace(".claude/hooks/guard-destructive.ts", presence)).toBe(
      "scripts",
    );
    expect(classifyFileWithWorkspace("templates/package.json.tpl", presence)).toBe("product");
    expect(classifyFileWithWorkspace("template-sources/ai/.codex/hooks/lib.ts", presence)).toBe(
      "product",
    );
    expect(classifyFileWithWorkspace(".codex/config.toml", presence)).toBe("config");
    expect(classifyFileWithWorkspace(".claude/settings.json", presence)).toBe("config");
    expect(classifyFileWithWorkspace("config/generated-dependencies/baseline.pkl", presence)).toBe(
      "config",
    );
    expect(classifyFileWithWorkspace("package.json", presence)).toBe("config");
    expect(classifyFileWithWorkspace("apps/frontend/src/main.tsx", presence)).toBe("frontend");
  });

  test("ignores workspace paths when the workspace is absent", () => {
    expect(
      classifyFileWithWorkspace("apps/frontend/src/main.tsx", {
        backend: true,
        frontend: false,
      }),
    ).toBeNull();
    expect(
      classifyFileWithWorkspace("src/index.ts", {
        backend: false,
        frontend: true,
      }),
    ).toBeNull();
  });
});

describe("classifyScopes", () => {
  test("collects unique scopes from multiple files", () => {
    expect(
      classifyScopes([
        "src/index.ts",
        "scripts/setup/bootstrap.ts",
        "templates/package.json.tpl",
        "package.json",
      ]),
    ).toEqual(new Set(["backend", "scripts", "product", "config"]));
  });
});

describe("expandConfigScopeWithWorkspace", () => {
  test("expands config changes to backend and scripts", () => {
    expect(
      expandConfigScopeWithWorkspace(new Set(["config"]), { backend: true, frontend: false }),
    ).toEqual(new Set(["config", "backend", "scripts", "product"]));
  });

  test("adds frontend when the workspace exists", () => {
    expect(
      expandConfigScopeWithWorkspace(new Set(["config"]), { backend: true, frontend: true }),
    ).toEqual(new Set(["config", "backend", "scripts", "product", "frontend"]));
  });
});

describe("module constants", () => {
  test("matches code-like extensions", () => {
    expect(CODE_PATTERN.test("file.tsx")).toBe(true);
    expect(CODE_PATTERN.test("file.md")).toBe(true);
    expect(CODE_PATTERN.test("file.tpl")).toBe(true);
  });

  test("keeps current repo behavior for frontend-less classifyFile", () => {
    expect(classifyFile("apps/frontend/src/main.tsx")).toBeNull();
  });
});
