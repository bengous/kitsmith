import type { TemplateContext } from "../types.ts";
import type { GeneratedProjectContract } from "./generated-project-contract.ts";
import { describe, expect, test } from "bun:test";
import { buildGeneratedProjectContract } from "./generated-project-contract.ts";
import { toBinName, toPackageName, toProjectName } from "./naming.ts";
import { renderTemplate, templateValues, templateValuesFromContract } from "./template.ts";

const backendContext: TemplateContext = {
  projectName: toProjectName("forge-backend"),
  packageName: toPackageName("forge-backend"),
  binName: toBinName("forge-backend"),
  backend: true,
  frontend: "none",
  ai: false,
  effect: false,
  hasWorkspaces: false,
};

const frontendAiContext: TemplateContext = {
  projectName: toProjectName("forge-frontend"),
  packageName: toPackageName("forge-frontend"),
  binName: toBinName("forge-frontend"),
  backend: false,
  frontend: "tanstack",
  ai: true,
  effect: false,
  hasWorkspaces: true,
};

const effectContext: TemplateContext = {
  projectName: toProjectName("forge-effect"),
  packageName: toPackageName("forge-effect"),
  binName: toBinName("forge-effect"),
  backend: true,
  frontend: "none",
  ai: false,
  effect: true,
  hasWorkspaces: false,
};

function contractFor(context: TemplateContext): GeneratedProjectContract {
  return buildGeneratedProjectContract({
    destination: "",
    projectName: context.projectName,
    packageName: context.packageName,
    binName: context.binName,
    backend: context.backend,
    frontend: context.frontend,
    ai: context.ai,
    effect: context.effect,
    install: false,
    gitInit: false,
    yes: true,
  });
}

describe("templateValues", () => {
  test("omits optional script blocks when features are disabled", () => {
    const values = templateValues(backendContext);
    expect(values["WORKSPACES_BLOCK"]).toBe("");
    expect(values["AI_SCRIPTS"]).toBe("");
    expect(values["EFFECT_SCRIPTS"]).toBe("");
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).toBe("");
    expect(values["EFFECT_DEV_DEPENDENCIES"]).toBe("");
    expect(values["EFFECT_TSCONFIG_PLUGINS"]).toBe("");
    expect(values["FRONTEND_SCRIPTS"]).toBe("");
    expect(values["BIN_BLOCK"]).toContain('"bin"');
  });

  test("includes optional script blocks when features are enabled", () => {
    const values = templateValues(frontendAiContext);
    expect(values["WORKSPACES_BLOCK"]).toContain('"workspaces": [');
    expect(values["WORKSPACES_BLOCK"]).toContain('"apps/*"');
    expect(values["AI_SCRIPTS"]).toContain('"agents:sync"');
    expect(values["AI_SCRIPTS"]).not.toContain('"agents:check"');
    expect(values["FRONTEND_SCRIPTS"]).toContain('"build"');
    expect(values["BIN_BLOCK"]).toBe("");
    expect(values["ROOT_LINT_PATHS"]).toBe(
      "scripts/ .agents/scripts/hooks/ .codex/hooks/ .claude/hooks/",
    );
  });

  test("includes Effect tokens when effect is enabled", () => {
    const values = templateValues(effectContext);
    expect(values["EFFECT_SCRIPTS"]).toBe("");
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).toContain('"effect"');
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).not.toContain('"@effect/cli"');
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).toContain('"@effect/platform"');
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).toContain('"@effect/platform-bun"');
    expect(values["ROOT_DEV_DEPENDENCIES"]).toContain('"@effect/language-service"');
    expect(values["EFFECT_TSCONFIG_PLUGINS"]).toContain("@effect/language-service");
    expect(values["EFFECT_TSCONFIG_PLUGINS"]).toContain("diagnosticSeverity");
  });
});

describe("templateValuesFromContract characterization", () => {
  test("projects backend-only package and root tooling tokens", () => {
    const values = templateValuesFromContract(contractFor(backendContext));

    expect(values["DEV_COMMAND"]).toBe("bun run src/index.ts");
    expect(values["TEST_COMMAND"]).toBe("bun test ./src");
    expect(values["BIN_BLOCK"]).toBe('  "bin": {\n    "forge-backend": "./src/index.ts"\n  },\n');
    expect(values["ROOT_LINT_PATHS"]).toBe("src/ scripts/");
    expect(values["ROOT_ARCH_PATHS"]).toBe("src scripts");
    expect(values["TSCONFIG_INCLUDE"]).toBe('    "src/**/*.ts",\n    "scripts/**/*.ts"');
    expect(values["BACKEND_LEFTHOOK_GLOB"]).toBe('        - "src/**/*.ts"\n');
  });

  test("projects frontend package, script, and workspace tokens", () => {
    const values = templateValuesFromContract(contractFor(frontendAiContext));

    expect(values["WORKSPACES_BLOCK"]).toBe('  "workspaces": [\n    "apps/*"\n  ],\n');
    expect(values["FRONTEND_PACKAGE_NAME"]).toBe("@forge-frontend/frontend");
    expect(values["FRONTEND_SCRIPTS"]).toContain(
      '    "build": "bun run --cwd apps/frontend build",\n',
    );
    expect(values["FRONTEND_SCRIPTS"]).not.toContain("test:e2e");
    expect(values["FRONTEND_LEFTHOOK_COMMAND"]).toContain("frontend-oxc:");
    expect(values["FRONTEND_TYPECHECK_GLOB"]).toBe('        - "apps/frontend/**/*.{ts,tsx}"\n');
    expect(values["FRONTEND_PACKAGE_SCRIPTS"]).toContain('    "dev": "vite dev --port 3000"');
  });

  test("projects Effect dependency and tsconfig plugin tokens without public scripts", () => {
    const values = templateValuesFromContract(contractFor(effectContext));

    expect(values["EFFECT_SCRIPTS"]).toBe("");
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).toContain('  "dependencies": {');
    expect(values["EFFECT_DEPENDENCIES_BLOCK"]).toContain('    "effect": ');
    expect(values["ROOT_DEV_DEPENDENCIES"]).toContain('    "@effect/language-service": "0.85.1"');
    expect(values["EFFECT_TSCONFIG_PLUGINS"]).toContain('"name": "@effect/language-service"');
    expect(values["EFFECT_TSCONFIG_PLUGINS"]).toContain('"strictEffectProvide": "warning"');
  });
});

describe("renderTemplate", () => {
  test("renders package.json without unresolved tokens", () => {
    const rendered = renderTemplate("package.json.tpl", frontendAiContext);
    expect(rendered).toContain('"name": "forge-frontend"');
    expect(rendered).toContain('"agents:sync"');
    expect(rendered).toContain('"build": "bun run --cwd apps/frontend build"');
    expect(rendered).toContain('"dev": "bun run --cwd apps/frontend dev"');
    expect(rendered).toContain(
      '"test": "bun run --cwd apps/frontend test && bun test ./.agents/scripts/hooks ./.codex/hooks ./.claude/hooks ./scripts/validation"',
    );
    expect(rendered).not.toContain('"test:hooks"');
    expect(rendered).not.toContain('"agents:check"');
    expect(rendered).not.toContain("__");
  });

  test("renders frontend route content with the project title", () => {
    const rendered = renderTemplate("apps/frontend/src/routes/index.tsx.tpl", frontendAiContext);
    expect(rendered).toContain("<h1>forge-frontend</h1>");
    expect(rendered).toContain("normalized by Kitsmith");
  });

  test("renders frontend agent guidance for TanStack workspaces", () => {
    const rendered = renderTemplate(".claude/rules/frontend-code.md.tpl", frontendAiContext);
    expect(rendered).toContain('  - "apps/frontend/**"');
    expect(rendered).toContain("TanStack Router");
    expect(rendered).toContain("routeTree.gen.ts");
    expect(rendered).not.toContain("__");
  });

  test("renders backend agent source guidance", () => {
    const rendered = renderTemplate(".claude/rules/source-code.md.tpl", backendContext);
    expect(rendered).toContain('  - "src/**/*.ts"');
    expect(rendered).toContain("## Source Code Conventions");
    expect(rendered).not.toContain("__");
  });

  test("renders lefthook without frontend commands for backend-only projects", () => {
    const rendered = renderTemplate("lefthook.yml.tpl", backendContext);
    expect(rendered).toContain("glob_matcher: doublestar");
    expect(rendered).toContain("root-oxc:");
    expect(rendered).toContain("typecheck:");
    expect(rendered).not.toContain("frontend-oxc:");
    expect(rendered).not.toContain("apps/frontend/**/*.{ts,tsx}");
  });

  test("renders lefthook with frontend commands when TanStack is enabled", () => {
    const rendered = renderTemplate("lefthook.yml.tpl", frontendAiContext);
    expect(rendered).toContain("frontend-oxc:");
    expect(rendered).toContain("apps/frontend/**/*.{ts,tsx}");
    expect(rendered).toContain(".agents/scripts/hooks/**/*.ts");
    expect(rendered).toContain(".codex/hooks/**/*.ts");
    expect(rendered).toContain(".claude/hooks/**/*.ts");
    expect(rendered).not.toContain("src/**/*.ts");
  });

  test("renders frontend-only tsconfig and Knip workspaces", () => {
    const tsconfig = renderTemplate("tsconfig.json.tpl", frontendAiContext);
    const knip = renderTemplate("knip.jsonc.tpl", frontendAiContext);

    expect(tsconfig).toContain('"scripts/**/*.ts"');
    expect(tsconfig).toContain('".agents/scripts/hooks/**/*.ts"');
    expect(tsconfig).toContain('".codex/hooks/**/*.ts"');
    expect(tsconfig).toContain('".claude/hooks/**/*.ts"');
    expect(tsconfig).not.toContain('"src/**/*.ts"');
    expect(knip).toContain('"apps/frontend"');
    expect(knip).toContain('"@commitlint/cli"');
    expect(knip).toContain('"jscpd"');
    expect(knip).toContain('"lefthook"');
    expect(knip).toContain('".agents/scripts/hooks/**/*.ts"');
    expect(knip).toContain('".codex/hooks/**/*.ts"');
    expect(knip).toContain('".claude/hooks/**/*.ts"');
    expect(knip).not.toContain('"src/index.ts"');
  });

  test("renders package.json with Effect dependencies when enabled", () => {
    const rendered = renderTemplate("package.json.tpl", effectContext);
    expect(rendered).toContain('"effect"');
    expect(rendered).toContain('"@effect/language-service"');
    expect(rendered).not.toContain('"effect:diagnose"');
    expect(rendered).not.toContain("__");
  });

  test("renders tsconfig.json with Effect plugin when enabled", () => {
    const rendered = renderTemplate("tsconfig.json.tpl", effectContext);
    expect(rendered).toContain("@effect/language-service");
    expect(rendered).toContain("diagnosticSeverity");
    expect(rendered).not.toContain("__");
  });

  test("renders tsconfig.json without plugin when effect is disabled", () => {
    const rendered = renderTemplate("tsconfig.json.tpl", backendContext);
    expect(rendered).not.toContain("plugins");
    expect(rendered).not.toContain("__");
  });

  test("renders Effect starter module and test", () => {
    const entry = renderTemplate("src/index.effect.ts.tpl", effectContext);
    const starterTest = renderTemplate("src/index.effect.test.ts.tpl", effectContext);

    expect(entry).toContain('export const projectName = "forge-effect"');
    expect(entry).toContain("Context.Tag");
    expect(entry).toContain("BunRuntime.runMain");
    expect(entry).toContain("Effect.gen");
    expect(starterTest).toContain("Effect.runPromise");
    expect(starterTest).toContain("Greeter");
  });

  test("renders a real backend starter module and test", () => {
    const entry = renderTemplate("src/index.ts.tpl", backendContext);
    const starterTest = renderTemplate("src/index.test.ts.tpl", backendContext);

    expect(entry).toContain('export const projectName = "forge-backend";');
    expect(entry).toContain("export function createGreeting");
    expect(entry).toContain("console.log(createGreeting())");
    expect(starterTest).toContain('import { createGreeting, projectName } from "./index";');
    expect(starterTest).toContain("expect(createGreeting()).toBe(`Hello from ");
    expect(starterTest).toContain("${".concat("projectName}`"));
  });
});
