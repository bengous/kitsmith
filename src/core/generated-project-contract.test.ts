import { expect, test } from "bun:test";
import {
  buildGeneratedProjectContract,
  describeGeneratedProject,
} from "./generated-project-contract.ts";
import { toBinName, toPackageName, toProjectName } from "./naming.ts";

function makeOptions(): Parameters<typeof buildGeneratedProjectContract>[0] {
  return {
    destination: "/tmp/forge-contract",
    projectName: toProjectName("forge-tanstack-ai-effect"),
    packageName: toPackageName("forge-tanstack-ai-effect"),
    binName: toBinName("forge-tanstack-ai-effect"),
    backend: true,
    frontend: "tanstack" as const,
    ai: true,
    effect: true,
    install: false,
    gitInit: false,
    yes: true,
  };
}

test("buildGeneratedProjectContract models root and frontend package facts", () => {
  const contract = buildGeneratedProjectContract(makeOptions());

  expect(contract.packageJson.name).toBe("forge-tanstack-ai-effect");
  expect(contract.packageJson.bin).toEqual({ "forge-tanstack-ai-effect": "./src/index.ts" });
  expect(contract.packageJson.workspaces).toEqual(["apps/*"]);
  expect(contract.packageJson.scripts["test"]).toBe(
    "bun test ./src && bun run --cwd apps/frontend test && bun test ./.agents/scripts/hooks ./.codex/hooks ./.claude/hooks ./scripts/validation",
  );
  expect(contract.packageJson.scripts["build"]).toBe("bun run --cwd apps/frontend build");
  expect(contract.packageJson.scripts["agents:sync"]).toBe(
    "bun scripts/agents/sync-agents-md.ts --write",
  );
  expect(contract.packageJson.scripts["agents:check"]).toBeUndefined();
  expect(contract.packageJson.scripts["effect:diagnose"]).toBeUndefined();
  expect(contract.packageJson.dependencies).toEqual({
    "@effect/platform": "0.96.1",
    "@effect/platform-bun": "0.89.0",
    effect: "3.21.2",
  });
  expect(contract.packageJson.devDependencies["@effect/language-service"]).toBe("0.85.1");
  expect(contract.rootTooling.tsconfigInclude).toEqual([
    "src/**/*.ts",
    "scripts/**/*.ts",
    ".agents/scripts/hooks/**/*.ts",
    ".codex/hooks/**/*.ts",
    ".claude/hooks/**/*.ts",
  ]);
  expect(contract.rootTooling.lefthookTypecheckGlobs).toContain("apps/frontend/**/*.{ts,tsx}");
  expect(contract.frontend.enabled && contract.frontend.packageJson.dependencies).toEqual({
    "@tanstack/react-router": "1.169.2",
    react: "19.2.6",
    "react-dom": "19.2.6",
  });
});

test("describeGeneratedProject remains a compatibility projection", () => {
  const contract = buildGeneratedProjectContract(makeOptions());
  const description = describeGeneratedProject(makeOptions());

  expect(description).toEqual({
    shape: contract.shape,
    templateContext: contract.templateContext,
    nativeBootstrapFlags: contract.nativeBootstrapFlags,
    cleanupPaths: contract.cleanupPaths,
    presetCopySpecs: contract.presetCopySpecs,
    templateRenderSpecs: contract.templateRenderSpecs,
    generatedFileSpecs: contract.generatedFileSpecs,
  });
});
