import type { InitOptions } from "../types.ts";
import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertGeneratedProjectContract } from "../../scripts/testing/generated-project-contract-runner.ts";
import { buildGeneratedProjectContract } from "./generated-project-contract.ts";
import { defaultGenerationRuntime, generateProjectWithRuntime } from "./generator.ts";
import { objectField, readJsonObject } from "./json.ts";
import { toBinName, toPackageName, toProjectName } from "./naming.ts";

type Scenario = {
  readonly name: string;
  readonly backend: boolean;
  readonly frontend: "none" | "tanstack";
  readonly ai: boolean;
  readonly effect: boolean;
};

const scenarios: readonly Scenario[] = [
  { name: "none-plain", backend: true, frontend: "none", ai: false, effect: false },
  { name: "none-ai", backend: true, frontend: "none", ai: true, effect: false },
  { name: "none-effect", backend: true, frontend: "none", ai: false, effect: true },
  { name: "none-ai-effect", backend: true, frontend: "none", ai: true, effect: true },
  { name: "tanstack-plain", backend: true, frontend: "tanstack", ai: false, effect: false },
  { name: "tanstack-frontend", backend: false, frontend: "tanstack", ai: false, effect: false },
  { name: "tanstack-ai", backend: true, frontend: "tanstack", ai: true, effect: false },
  { name: "tanstack-ai-frontend", backend: false, frontend: "tanstack", ai: true, effect: false },
  { name: "tanstack-effect", backend: true, frontend: "tanstack", ai: false, effect: true },
  { name: "tanstack-ai-effect", backend: true, frontend: "tanstack", ai: true, effect: true },
];

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeFile(path: string, content: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

async function scaffoldBackendNative(destination: string): Promise<void> {
  await writeFile(join(destination, ".gitignore"), "node_modules\n");
  await writeFile(join(destination, "README.md"), "NATIVE BACKEND README");
  await writeFile(join(destination, "tsconfig.json"), '{"compilerOptions":{}}');
  await writeFile(join(destination, "CLAUDE.md"), "NATIVE CLAUDE");
  await writeFile(join(destination, "index.ts"), 'console.log("native backend");');
  await writeFile(join(destination, "bun.lock"), "native lock");
  await writeFile(join(destination, "node_modules/native.txt"), "native dependency");
}

async function scaffoldFrontendNative(destination: string): Promise<void> {
  const root = join(destination, "apps/frontend");
  await writeFile(join(root, ".cta.json"), "{}");
  await writeFile(join(root, ".vscode/settings.json"), "{}");
  await writeFile(join(root, "README.md"), "NATIVE FRONTEND README");
  await writeFile(join(root, "public/icon.svg"), "<svg />");
  await writeFile(join(root, "src/components/demo.tsx"), "export function Demo() { return null; }");
  await writeFile(join(root, "src/router.tsx"), "export const router = null;");
  await writeFile(
    join(root, "src/routes/about.tsx"),
    "export default function About() { return null; }",
  );
  await writeFile(join(root, "src/routes/__root.tsx"), "native-root");
  await writeFile(join(root, "src/routes/index.tsx"), "native-index");
  await writeFile(join(root, "src/main.tsx"), "native-main");
  await writeFile(join(root, "src/routeTree.gen.ts"), "native-route-tree");
  await writeFile(join(root, "package.json"), '{"name":"native-frontend"}');
}

function makeOptions(destination: string, scenario: Scenario): InitOptions {
  return {
    destination,
    projectName: toProjectName(`forge-${scenario.name}`),
    packageName: toPackageName(`forge-${scenario.name}`),
    binName: toBinName(`forge-${scenario.name}`),
    backend: scenario.backend,
    frontend: scenario.frontend,
    ai: scenario.ai,
    effect: scenario.effect,
    install: false,
    gitInit: false,
    yes: true,
  };
}

async function generateScenario(scenario: Scenario): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), `kitsmith-contract-${scenario.name}-`));
  tempDirs.push(destination);

  await generateProjectWithRuntime(makeOptions(destination, scenario), {
    ...defaultGenerationRuntime,
    bootstrapBackendNative: async (dir) => {
      await scaffoldBackendNative(dir);
    },
    bootstrapFrontendNative: async (dir) => {
      await scaffoldFrontendNative(dir);
    },
  });

  return destination;
}

async function expectContractRejects(
  destination: string,
  scenario: Scenario,
  expectedMessage: string,
): Promise<void> {
  try {
    await assertGeneratedProjectContract(
      destination,
      buildGeneratedProjectContract(makeOptions(destination, scenario)),
    );
    throw new Error(`Expected generated project contract to reject ${expectedMessage}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(expectedMessage);
  }
}

function expectedPublicScripts(scenario: Scenario): string[] {
  return [
    "autofix",
    ...(scenario.frontend === "tanstack" ? ["build"] : []),
    "check",
    "dev",
    "setup",
    "test",
    "validate",
    ...(scenario.ai ? ["agents:sync"] : []),
  ].toSorted();
}

test("generated project contract rejects extra root package scripts", async () => {
  const scenario: Scenario = {
    name: "none-plain",
    backend: true,
    frontend: "none",
    ai: false,
    effect: false,
  };
  const destination = await generateScenario(scenario);
  const packagePath = join(destination, "package.json");
  const packageJson = await readJsonObject(packagePath);
  const scripts = objectField(packageJson, "scripts");

  await Bun.write(
    packagePath,
    JSON.stringify(
      {
        ...packageJson,
        scripts: {
          ...scripts,
          unexpected: "bun unexpected",
        },
      },
      null,
      2,
    ),
  );

  await expectContractRejects(destination, scenario, "root scripts");
});

test("generated project contract rejects extra frontend package dependencies", async () => {
  const scenario: Scenario = {
    name: "tanstack-plain",
    backend: true,
    frontend: "tanstack",
    ai: false,
    effect: false,
  };
  const destination = await generateScenario(scenario);
  const packagePath = join(destination, "apps/frontend/package.json");
  const packageJson = await readJsonObject(packagePath);
  const dependencies = objectField(packageJson, "dependencies");

  await Bun.write(
    packagePath,
    JSON.stringify(
      {
        ...packageJson,
        dependencies: {
          ...dependencies,
          unexpected: "1.0.0",
        },
      },
      null,
      2,
    ),
  );

  await expectContractRejects(destination, scenario, "frontend dependencies");
});

test("generated base project exposes only the public command surface", async () => {
  const scenario: Scenario = {
    name: "none-plain",
    backend: true,
    frontend: "none",
    ai: false,
    effect: false,
  };
  const destination = await generateScenario(scenario);
  const packageJson = await readJsonObject(join(destination, "package.json"));
  const scripts = objectField(packageJson, "scripts");

  expect(Object.keys(scripts).toSorted()).toEqual([
    "autofix",
    "check",
    "dev",
    "setup",
    "test",
    "validate",
  ]);
});

test("generated public scripts match the exact shape and preset matrix", async () => {
  for (const scenario of scenarios) {
    const destination = await generateScenario(scenario);
    const packageJson = await readJsonObject(join(destination, "package.json"));
    const scripts = objectField(packageJson, "scripts");

    expect(Object.keys(scripts).toSorted()).toEqual(expectedPublicScripts(scenario));

    expect(String(scripts["test"])).not.toContain("build");
    expect(String(scripts["test"])).not.toContain("test:e2e");
    expect(String(scripts["test"])).not.toContain("playwright");
  }
}, 20_000);

for (const scenario of scenarios) {
  test(`generated project contract: ${scenario.name}`, async () => {
    const destination = await generateScenario(scenario);
    const description = buildGeneratedProjectContract(makeOptions(destination, scenario));

    await assertGeneratedProjectContract(destination, description);
    expect(await Bun.file(join(destination, "README.md")).exists()).toBe(false);

    if (scenario.frontend === "tanstack") {
      expect(
        await Bun.file(join(destination, "apps/frontend/src/routes/index.tsx")).text(),
      ).not.toContain("native-index");
    }
  });
}
