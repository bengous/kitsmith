import { expect, test } from "bun:test";
import { GENERATED_DEPENDENCY_PACKAGES } from "./generated-dependencies.generated.ts";
import { resolveGeneratedDependencySections } from "./generated-dependencies.ts";
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
  const dependencySections = resolveGeneratedDependencySections(contract.shape);
  expect(contract.packageJson.dependencies ?? {}).toEqual(dependencySections.rootDependencies);
  expect(contract.packageJson.devDependencies).toEqual(dependencySections.rootDevDependencies);
  expect(contract.rootTooling.tsconfigInclude).toEqual([
    "src/**/*.ts",
    "scripts/**/*.ts",
    ".agents/scripts/hooks/**/*.ts",
    ".codex/hooks/**/*.ts",
    ".claude/hooks/**/*.ts",
  ]);
  expect(contract.rootTooling.lefthookTypecheckGlobs).toContain("apps/frontend/**/*.{ts,tsx}");
  expect(contract.frontend.enabled && contract.frontend.packageJson.dependencies).toEqual(
    dependencySections.frontendDependencies,
  );
  expect(contract.frontend.enabled && contract.frontend.packageJson.devDependencies).toEqual(
    dependencySections.frontendDevDependencies,
  );
});

test("describeGeneratedProject remains a contract projection", () => {
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

test("runtime dependency assembly does not hardcode generated dependency versions", async () => {
  const sourceUrls = [
    new URL("./generated-project-contract.ts", import.meta.url),
    new URL("./template.ts", import.meta.url),
  ];
  const sources = await Promise.all(sourceUrls.map(async (url) => Bun.file(url).text()));
  const generatedDependencyVersions = new Set(
    Object.values(GENERATED_DEPENDENCY_PACKAGES).map((dependency) => dependency.version),
  );

  for (const version of generatedDependencyVersions) {
    for (const source of sources) {
      expect(source).not.toContain(`"${version}"`);
    }
  }
});
