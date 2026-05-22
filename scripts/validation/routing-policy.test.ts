import type {
  QualityWorkspace as GeneratedQualityWorkspace,
  RoutingScope as GeneratedRoutingScope,
} from "../../template-sources/base/scripts/validation/shared/quality-scope-policy.ts";
import type { RoutingContext } from "./routing-policy.ts";
import { describe, expect, test } from "bun:test";
import {
  classifyRoutingPath as classifyGeneratedRoutingPath,
  resolveQualityWorkspace as resolveGeneratedQualityWorkspace,
} from "../../template-sources/base/scripts/validation/shared/quality-scope-policy.ts";
import {
  classifyRoutingPath,
  requiresGeneratedDependencyCheck,
  resolveQualityWorkspace,
} from "./routing-policy.ts";

const liveContext = {
  kind: "live-repo",
  presence: { backend: true, frontend: true },
} satisfies RoutingContext;

const generatedContext = {
  kind: "generated-project",
  presence: { backend: true, frontend: true },
} satisfies RoutingContext;

const backendOnlyContext = {
  kind: "generated-project",
  presence: { backend: true, frontend: false },
} satisfies RoutingContext;

const frontendOnlyContext = {
  kind: "generated-project",
  presence: { backend: false, frontend: true },
} satisfies RoutingContext;

function generatedExpectedScope(
  scope: ReturnType<typeof classifyRoutingPath>,
): GeneratedRoutingScope | null {
  if (scope === "product") {
    throw new Error("Generated routing parity unexpectedly produced product scope");
  }
  return scope;
}

function generatedExpectedWorkspace(
  workspace: ReturnType<typeof resolveQualityWorkspace>,
): GeneratedQualityWorkspace | null {
  if (workspace === null) {
    return null;
  }
  if (workspace.name === "product") {
    throw new Error("Generated routing parity unexpectedly produced product workspace");
  }
  return {
    name: workspace.name,
    oxlintConfig: workspace.oxlintConfig,
    oxlintArgs: workspace.oxlintArgs,
    oxfmtConfig: workspace.oxfmtConfig,
    lint: workspace.lint,
    lintFix: workspace.lintFix,
    formatMode: workspace.formatMode,
  };
}

describe("routing policy", () => {
  test("classifies live repo and generated project surfaces differently", () => {
    expect(classifyRoutingPath("src/index.ts", liveContext)).toBe("backend");
    expect(classifyRoutingPath("scripts/validation/validate.ts", liveContext)).toBe("scripts");
    expect(classifyRoutingPath("apps/frontend/src/main.tsx", liveContext)).toBe("frontend");
    expect(classifyRoutingPath("templates/package.json.tpl", liveContext)).toBe("product");
    expect(classifyRoutingPath("template-sources/base/.oxlintrc.jsonc", liveContext)).toBe(
      "product",
    );

    expect(classifyRoutingPath("src/index.ts", generatedContext)).toBe("backend");
    expect(classifyRoutingPath("scripts/validation/validate.ts", generatedContext)).toBe("scripts");
    expect(classifyRoutingPath("apps/frontend/src/main.tsx", generatedContext)).toBe("frontend");
    expect(classifyRoutingPath("templates/package.json.tpl", generatedContext)).toBeNull();
    expect(
      classifyRoutingPath("template-sources/ai/.codex/hooks/lib.ts", generatedContext),
    ).toBeNull();
  });

  test("resolves quality workspaces without duplicating hook policy", () => {
    expect(resolveQualityWorkspace("scripts/validation/validate.ts", liveContext)?.name).toBe(
      "root",
    );
    expect(resolveQualityWorkspace(".codex/hooks/lib.ts", liveContext)).toMatchObject({
      name: "codex-hooks",
      lint: true,
      lintFix: false,
      formatMode: "check",
    });
    expect(resolveQualityWorkspace(".agents/hooks/core/contract.ts", liveContext)).toMatchObject({
      name: "root",
      lint: true,
      lintFix: true,
      formatMode: "write",
    });
    expect(
      resolveQualityWorkspace("template-sources/ai/.codex/hooks/lib.ts", liveContext),
    ).toMatchObject({ name: "product", lint: false, formatMode: "write" });

    expect(
      resolveQualityWorkspace("template-sources/ai/.codex/hooks/lib.ts", generatedContext),
    ).toBeNull();
    expect(resolveQualityWorkspace("apps/frontend/src/main.tsx", generatedContext)).toMatchObject({
      name: "frontend",
      oxlintArgs: ["--type-aware"],
    });
  });

  test("honors workspace presence when resolving quality workspaces", () => {
    expect(resolveQualityWorkspace("apps/frontend/src/main.tsx", backendOnlyContext)).toBeNull();
    expect(resolveQualityWorkspace("src/index.ts", frontendOnlyContext)).toBeNull();
    expect(
      resolveQualityWorkspace("scripts/validation/validate.ts", frontendOnlyContext)?.name,
    ).toBe("root");
  });

  test("generated routing projection matches the maintainer policy for generated paths", () => {
    const paths = [
      "src/index.ts",
      "scripts/validation/validate.ts",
      ".agents/hooks/core/contract.ts",
      ".codex/hooks/lib.ts",
      ".claude/hooks/guard-destructive.ts",
      "apps/frontend/src/main.tsx",
      "templates/package.json.tpl",
      "template-sources/base/.oxlintrc.jsonc",
    ];

    for (const path of paths) {
      expect(classifyGeneratedRoutingPath(path, generatedContext)).toBe(
        generatedExpectedScope(classifyRoutingPath(path, generatedContext)),
      );
      expect(resolveGeneratedQualityWorkspace(path, generatedContext)).toEqual(
        generatedExpectedWorkspace(resolveQualityWorkspace(path, generatedContext)),
      );
    }
  });

  test("detects generated dependency invariant surfaces", () => {
    for (const path of [
      "config/generated-dependencies/baseline.pkl",
      "src/core/generated-dependencies.generated.ts",
      "package.json",
      "bun.lock",
      "templates/package.json.tpl",
      "template-sources/base/mise.toml",
    ]) {
      expect(requiresGeneratedDependencyCheck(path), path).toBe(true);
    }

    expect(requiresGeneratedDependencyCheck("src/index.ts")).toBe(false);
  });
});
