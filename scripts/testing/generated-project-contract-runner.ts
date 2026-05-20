import type { GeneratedProjectContract } from "../../src/core/generated-project-contract.ts";
import type { JsonObject } from "../../src/core/json.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isJsonObject, objectField, readJsonObject } from "../../src/core/json.ts";

function assertPathExists(root: string, relativePath: string): void {
  if (!existsSync(join(root, relativePath))) {
    throw new Error(`Expected generated path to exist: ${relativePath}`);
  }
}

function assertPathMissing(root: string, relativePath: string): void {
  if (existsSync(join(root, relativePath))) {
    throw new Error(`Expected generated path to be absent: ${relativePath}`);
  }
}

function formatUnknown(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${label} to be ${formatUnknown(expected)}, got ${formatUnknown(actual)}`,
    );
  }
}

function assertUndefined(actual: unknown, label: string): void {
  if (actual !== undefined) {
    throw new Error(`Expected ${label} to be absent, got ${formatUnknown(actual)}`);
  }
}

function assertDefined(actual: unknown, label: string): void {
  if (actual === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
}

function assertObjectHasKey(source: JsonObject, key: string, label: string): void {
  if (source[key] === undefined) {
    throw new Error(`Expected ${label} to include ${key}`);
  }
}

function sortedKeys(source: JsonObject | Readonly<Record<string, string>>): string[] {
  return Object.keys(source).toSorted();
}

function assertJsonRecordExact(
  source: JsonObject,
  expected: Readonly<Record<string, string>>,
  label: string,
): void {
  const actualKeys = sortedKeys(source);
  const expectedKeys = sortedKeys(expected);
  assertEqual(JSON.stringify(actualKeys), JSON.stringify(expectedKeys), `${label} keys`);

  for (const [key, value] of Object.entries(expected)) {
    assertEqual(source[key], value, `${label} ${key}`);
  }
}

function assertNoExternalPackageExecutorScripts(scripts: JsonObject, label: string): void {
  const forbiddenExecutorPattern = /\b(?:bun\s+x|bunx|npx)\b/;

  for (const [scriptName, script] of Object.entries(scripts)) {
    if (typeof script !== "string") {
      continue;
    }
    if (forbiddenExecutorPattern.test(script)) {
      throw new Error(
        `Expected ${label} script ${scriptName} to avoid package executors, got ${JSON.stringify(
          script,
        )}`,
      );
    }
  }
}

async function assertGeneratedValidationRunnerAvoidsPackageExecutors(root: string): Promise<void> {
  const relativePath = "scripts/validation/internal/validation-runner.ts";
  const content = await Bun.file(join(root, relativePath)).text();
  const forbiddenSnippets = [
    "bun x",
    "bunx",
    "npx",
    '[process.execPath, "x"',
    '[process.execPath,"x"',
    '"bun", "x"',
    '"bun","x"',
  ];

  for (const snippet of forbiddenSnippets) {
    if (content.includes(snippet)) {
      throw new Error(
        `Expected ${relativePath} hidden validation commands to avoid package executors, found ${JSON.stringify(
          snippet,
        )}`,
      );
    }
  }
}

function assertOptionalJsonRecordExact(
  source: unknown,
  expected: Readonly<Record<string, string>> | undefined,
  label: string,
): void {
  if (expected === undefined) {
    assertUndefined(source, label);
    return;
  }
  if (!isJsonObject(source)) {
    throw new TypeError(`Expected ${label} to be an object`);
  }
  assertJsonRecordExact(source, expected, label);
}

function assertStringArrayExact(actual: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(actual)) {
    throw new TypeError(`Expected ${label} to be an array`);
  }
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

async function assertFileContains(
  root: string,
  relativePath: string,
  expected: string,
): Promise<void> {
  const content = await Bun.file(join(root, relativePath)).text();
  if (!content.includes(expected)) {
    throw new Error(`Expected ${relativePath} to contain ${JSON.stringify(expected)}`);
  }
}

async function assertFileExcludes(
  root: string,
  relativePath: string,
  expected: string,
): Promise<void> {
  const content = await Bun.file(join(root, relativePath)).text();
  if (content.includes(expected)) {
    throw new Error(`Expected ${relativePath} to exclude ${JSON.stringify(expected)}`);
  }
}

function assertGeneratedFileSet(root: string, contract: GeneratedProjectContract): void {
  const generatedPaths = new Set(contract.generatedFileSpecs.map((spec) => spec.relativePath));

  for (const spec of contract.generatedFileSpecs) {
    assertPathExists(root, spec.relativePath);
  }

  for (const relativePath of contract.cleanupPaths) {
    if (generatedPaths.has(relativePath)) {
      continue;
    }
    assertPathMissing(root, relativePath);
  }
}

async function assertRootContract(
  root: string,
  contract: GeneratedProjectContract,
  packageJson: JsonObject,
  packageScripts: JsonObject,
): Promise<void> {
  const packageName = contract.templateContext.packageName;
  const lefthook = await Bun.file(join(root, "lefthook.yml")).text();
  const devDependencies = objectField(packageJson, "devDependencies");

  assertPathExists(root, "package.json");
  assertPathExists(root, "bunfig.toml");
  assertPathExists(root, ".oxlintrc.jsonc");
  assertPathExists(root, "scripts/validation/validate.ts");
  assertPathExists(root, "scripts/validation/commit-message.ts");
  assertPathExists(root, "commitlint.config.js");
  assertPathMissing(root, "README.md");
  assertPathMissing(root, "scripts/validation/README.md");
  assertPathMissing(root, "scripts/agents/AGENTS.md");
  const validationPlanPath = "scripts/validation/internal/validation-plan.ts";
  assertPathExists(root, validationPlanPath);
  assertPathExists(root, "scripts/validation/internal/validation-runner.ts");
  assertPathExists(root, "scripts/validation/shared/quality-scope-policy.ts");
  assertPathExists(root, "knip.jsonc");
  assertPathExists(root, "scripts/quality/check-links-local.ts");
  assertNoExternalPackageExecutorScripts(packageScripts, "root package");
  await assertGeneratedValidationRunnerAvoidsPackageExecutors(root);

  await assertFileContains(root, "lefthook.yml", "glob_matcher: doublestar");
  await assertFileContains(root, "lefthook.yml", "commit-msg:");
  await assertFileContains(root, "lefthook.yml", "bun scripts/validation/commit-message.ts {1}");
  await assertFileContains(root, "commitlint.config.js", "@commitlint/config-conventional");
  await assertFileContains(root, "knip.jsonc", '"@commitlint/cli"');
  await assertFileContains(root, "knip.jsonc", '"jscpd"');
  await assertFileContains(root, ".oxlintrc.jsonc", '"correctness": "error"');
  await assertFileContains(root, "bunfig.toml", "exact = true");
  await assertFileContains(root, "bunfig.toml", "minimumReleaseAge = 259200");
  await assertFileContains(
    root,
    "lefthook.yml",
    "Keep these globs aligned with the repo surfaces they protect.",
  );
  if (lefthook.includes('glob: "src/**/*.ts,scripts/**/*.ts"')) {
    throw new Error("Expected Lefthook globs to use YAML lists, not CSV strings");
  }

  assertEqual(packageJson["name"], packageName, "root package name");
  assertEqual(packageJson["version"], contract.packageJson.version, "root package version");
  assertEqual(packageJson["type"], contract.packageJson.type, "root package type");
  assertEqual(packageJson["private"], contract.packageJson.private, "root package private");
  assertOptionalJsonRecordExact(packageJson["bin"], contract.packageJson.bin, "root bin");
  if (contract.packageJson.workspaces === undefined) {
    assertUndefined(packageJson["workspaces"], "workspaces");
  } else {
    assertStringArrayExact(
      packageJson["workspaces"],
      contract.packageJson.workspaces,
      "workspaces",
    );
  }
  assertOptionalJsonRecordExact(
    packageJson["dependencies"],
    contract.packageJson.dependencies,
    "root dependencies",
  );
  assertJsonRecordExact(
    devDependencies,
    contract.packageJson.devDependencies,
    "root devDependencies",
  );
  assertJsonRecordExact(packageScripts, contract.packageJson.scripts, "root scripts");
  assertPathMissing(root, "index.ts");
  assertPathMissing(root, "bun.lock");
  assertPathMissing(root, "node_modules");
  await assertFileContains(root, validationPlanPath, "GENERATED_PROJECT_VALIDATE_PLAN");
  await assertFileContains(root, validationPlanPath, "GENERATED_PROJECT_PUSH_VALIDATION_POLICY");
  await assertFileContains(root, validationPlanPath, "build:frontend");
  await assertFileExcludes(root, validationPlanPath, "guard-destructive:check");
  await assertFileExcludes(root, validationPlanPath, "test:project-contract");
}

async function assertBackendContract(
  root: string,
  contract: GeneratedProjectContract,
  packageJson: JsonObject,
  packageScripts: JsonObject,
): Promise<void> {
  const { backend, effect } = contract.shape;
  const projectName = contract.templateContext.projectName;
  const tsconfig = await Bun.file(join(root, "tsconfig.json")).text();
  const lefthook = await Bun.file(join(root, "lefthook.yml")).text();

  if (backend) {
    assertPathExists(root, "src/index.ts");
    assertPathExists(root, "src/index.test.ts");
    assertDefined(packageJson["bin"], "root bin");
    assertEqual(packageScripts["test"], contract.packageJson.scripts["test"], "root test script");
    if (!lefthook.includes('- "src/**/*.ts"')) {
      throw new Error('Expected Lefthook to include the backend "src/**/*.ts" glob');
    }
    await assertFileContains(root, "src/index.ts", `export const projectName = "${projectName}"`);

    if (effect) {
      await assertFileContains(root, "src/index.ts", "Context.Tag");
      await assertFileContains(root, "src/index.ts", "BunRuntime.runMain");
      await assertFileContains(root, "src/index.ts", "Effect.gen");
    } else {
      await assertFileContains(root, "src/index.ts", "export function createGreeting");
      await assertFileContains(root, "src/index.ts", "console.log(createGreeting())");
    }
    return;
  }

  assertUndefined(packageJson["bin"], "root bin");
  assertEqual(
    packageScripts["dev"],
    contract.packageJson.scripts["dev"],
    "frontend-only dev script",
  );
  assertEqual(
    packageScripts["test"],
    contract.packageJson.scripts["test"],
    "frontend-only test script",
  );
  assertUndefined(packageScripts["test:unit"], "test:unit script");
  assertPathMissing(root, "src/index.ts");
  assertPathMissing(root, "src/index.test.ts");
  if (lefthook.includes('- "src/**/*.ts"')) {
    throw new Error('Did not expect Lefthook to include the backend "src/**/*.ts" glob');
  }
  if (tsconfig.includes('"src/**/*.ts"')) {
    throw new Error('Did not expect frontend-only tsconfig to include "src/**/*.ts"');
  }
}

async function assertEffectContract(
  root: string,
  contract: GeneratedProjectContract,
  packageJson: JsonObject,
  packageScripts: JsonObject,
): Promise<void> {
  const dependencies = objectField(packageJson, "dependencies");
  const devDependencies = objectField(packageJson, "devDependencies");
  const tsconfig = await Bun.file(join(root, "tsconfig.json")).text();

  if (contract.shape.effect) {
    assertPathExists(root, ".gitkeep");
    assertObjectHasKey(dependencies, "effect", "dependencies");
    assertUndefined(dependencies["@effect/cli"], "@effect/cli dependency");
    assertObjectHasKey(dependencies, "@effect/platform", "dependencies");
    assertObjectHasKey(dependencies, "@effect/platform-bun", "dependencies");
    assertObjectHasKey(devDependencies, "@effect/language-service", "devDependencies");
    assertOptionalJsonRecordExact(
      packageJson["dependencies"],
      contract.packageJson.dependencies,
      "dependencies",
    );
    assertJsonRecordExact(devDependencies, contract.packageJson.devDependencies, "devDependencies");
    assertUndefined(packageScripts["effect:diagnose"], "effect:diagnose script");
    assertUndefined(packageScripts["effect:quickfixes"], "effect:quickfixes script");
    if (!tsconfig.includes("@effect/language-service")) {
      throw new Error("Expected tsconfig to include @effect/language-service");
    }
    return;
  }

  assertUndefined(packageJson["dependencies"], "dependencies");
  assertUndefined(packageScripts["effect:diagnose"], "effect:diagnose script");
  if (tsconfig.includes("plugins")) {
    throw new Error("Did not expect tsconfig plugins without Effect");
  }
}

async function assertAiContract(
  root: string,
  contract: GeneratedProjectContract,
  packageScripts: JsonObject,
): Promise<void> {
  const { ai, backend } = contract.shape;

  if (!ai) {
    assertPathMissing(root, "CLAUDE.md");
    assertPathMissing(root, ".claude");
    assertPathMissing(root, ".mcp.json");
    assertPathMissing(root, ".codex");
    assertPathMissing(root, "scripts/validation/format-and-lint.ts");
    assertPathMissing(root, "scripts/validation/format-and-lint-routing.ts");
    assertPathMissing(root, "scripts/validation/shared/quality-workspace.ts");
    assertPathMissing(root, "scripts/validation/shared/repo-path.ts");
    assertUndefined(packageScripts["agents:sync"], "agents:sync script");
    assertUndefined(packageScripts["agents:check"], "agents:check script");
    return;
  }

  assertPathExists(root, "CLAUDE.md");
  assertPathExists(root, ".claude/rules/agent-hook-runtime.md");
  assertPathExists(root, ".claude/rules/native-hook-wrappers.md");
  if (backend) {
    assertPathExists(root, ".claude/rules/source-code.md");
    assertPathExists(root, "src/AGENTS.md");
  } else {
    assertPathMissing(root, ".claude/rules/source-code.md");
    assertPathMissing(root, "src/AGENTS.md");
  }
  assertPathExists(root, ".claude/rules/validation-tooling.md");
  assertPathExists(root, "AGENTS.md");
  assertPathExists(root, ".agents/scripts/hooks/AGENTS.md");
  assertPathExists(root, ".codex/hooks/AGENTS.md");
  assertPathExists(root, ".claude/hooks/AGENTS.md");
  assertPathExists(root, "scripts/quality/AGENTS.md");
  assertPathExists(root, "scripts/validation/AGENTS.md");
  assertPathExists(root, ".agents/agents-md-manifest.json");
  assertPathExists(root, ".mcp.json");
  assertPathExists(root, ".codex/config.toml");
  await assertFileContains(root, ".codex/config.toml", "hooks = true");
  await assertFileContains(root, ".gitignore", ".agents/tmp/");
  assertPathMissing(root, ".codex/hooks.json");
  assertPathExists(root, ".codex/hooks/guard-destructive.ts");
  assertPathExists(root, ".codex/hooks/guard-edit-paths.ts");
  assertPathExists(root, ".codex/hooks/post-edit-quality.ts");
  assertPathExists(root, ".codex/hooks/stop-validate.ts");
  assertPathExists(root, ".claude/hooks/guard-destructive.ts");
  assertPathExists(root, ".claude/hooks/post-edit-quality.ts");
  assertPathExists(root, ".claude/hooks/stop-validate.ts");
  assertPathExists(root, ".agents/scripts/hooks/core/contract.ts");
  assertPathExists(root, ".agents/scripts/hooks/core/post-edit-quality.ts");
  assertPathExists(root, ".agents/scripts/hooks/adapters/codex.ts");
  assertPathExists(root, ".agents/scripts/hooks/adapters/claude.ts");
  assertPathExists(root, ".agents/scripts/hooks/adapters/pi.ts");
  assertPathExists(root, ".agents/scripts/hooks/adapters/pi-extension.test.ts");
  assertPathExists(root, ".pi/extensions/kitsmith-hooks.ts");
  assertPathExists(root, ".pi/hooks/guard-destructive.ts");
  assertPathExists(root, ".pi/hooks/guard-edit-paths.ts");
  assertPathExists(root, ".pi/hooks/post-edit-quality.ts");
  assertPathExists(root, ".pi/hooks/stop-validate.ts");
  assertPathExists(root, ".agents/scripts/hooks/runtime/run-post-edit-hook.ts");
  assertPathExists(root, ".agents/scripts/hooks/runtime/run-pre-tool-hook.ts");
  assertPathExists(root, ".agents/scripts/hooks/runtime/run-stop-hook.ts");
  assertPathExists(root, "scripts/validation/validate-on-stop.ts");
  assertPathExists(root, "scripts/validation/shared/quality-workspace.ts");
  assertPathExists(root, "scripts/validation/shared/repo-path.ts");
  assertPathExists(root, "scripts/agents/sync-agents-md.ts");

  await assertFileContains(root, "CLAUDE.md", "Fill this file with project-specific context");
  await assertFileContains(root, ".claude/rules/agent-hook-runtime.md", ".agents/scripts/hooks");
  await assertFileContains(root, ".claude/rules/native-hook-wrappers.md", "Keep wrappers thin");
  await assertFileContains(root, ".codex/config.toml", ".codex/hooks/guard-destructive.ts");
  await assertFileContains(
    root,
    ".codex/config.toml",
    'matcher = "^(apply_patch|Edit|Write|MultiEdit)$"',
  );
  await assertFileContains(root, ".codex/config.toml", "timeout = 90");
  await assertFileContains(root, ".codex/config.toml", "timeout = 240");
  await assertFileExcludes(root, ".codex/config.toml", "CLAUDE_PROJECT_DIR");
  await assertFileExcludes(root, ".codex/config.toml", "hooks.json");
  await assertFileExcludes(root, ".codex/config.toml", 'matcher = "^(apply_patch|Edit|Write)$"');
  await assertFileExcludes(root, ".codex/config.toml", "timeout = 45");
  await assertFileExcludes(root, ".codex/config.toml", "timeout = 180");
  await assertFileContains(
    root,
    ".codex/hooks/guard-destructive.ts",
    "../../.agents/scripts/hooks/adapters/codex.ts",
  );
  await assertFileContains(
    root,
    ".claude/hooks/guard-destructive.ts",
    "../../.agents/scripts/hooks/adapters/claude.ts",
  );
  await assertGeneratedAgentsManifest(root);
  await assertFileContains(root, "scripts/agents/sync-agents-md.ts", "toPosixPath");
  await assertFileContains(root, "scripts/agents/sync-agents-md.ts", "generated.map(toPosixPath)");
  await assertFileContains(root, "scripts/agents/sync-agents-md.ts", ".map(toPosixPath)");
  await assertFileContains(root, "scripts/validation/shared/repo-path.ts", "repoRelativePath");
  await assertFileContains(root, "scripts/validation/shared/repo-path.ts", "toPosixSeparators");
  await assertGeneratedAiStopHookContract(root);
  await assertFileContains(
    root,
    ".agents/scripts/hooks/core/post-edit-quality.ts",
    "resolveGeneratedProjectWorkspace",
  );
  await assertFileContains(
    root,
    ".agents/scripts/hooks/core/post-edit-quality.ts",
    "hasRoutableExtension",
  );
  await assertFileExcludes(
    root,
    ".agents/scripts/hooks/core/post-edit-quality.ts",
    "isProductSurface",
  );
  await assertFileExcludes(
    root,
    ".agents/scripts/hooks/core/post-edit-quality.ts",
    "template-sources/",
  );
  await assertFileContains(root, ".claude/settings.json", "$CLAUDE_PROJECT_DIR");
  await assertFileExcludes(root, ".claude/settings.json", ".codex/");
  await assertFileContains(root, "lefthook.yml", '- ".agents/scripts/hooks/**/*.ts"');
  await assertFileContains(root, "lefthook.yml", '- ".codex/hooks/**/*.ts"');
  await assertFileContains(root, "lefthook.yml", '- ".claude/hooks/**/*.ts"');
  await assertFileContains(root, "lefthook.yml", '- ".pi/hooks/**/*.ts"');
  await assertFileContains(root, "lefthook.yml", '- ".pi/extensions/**/*.ts"');
  assertPathMissing(root, ".pi/extensions/kitsmith-hooks.test.ts");
  await assertFileContains(root, ".oxlintrc.jsonc", '"!.agents/scripts/hooks/**"');
  await assertFileContains(root, "tsconfig.json", '".agents/scripts/hooks/**/*.ts"');
  await assertFileContains(root, "tsconfig.json", '".codex/hooks/**/*.ts"');
  await assertFileContains(root, "tsconfig.json", '".claude/hooks/**/*.ts"');
  await assertFileContains(root, "tsconfig.json", '".pi/hooks/**/*.ts"');
  await assertFileContains(root, "tsconfig.json", '".pi/extensions/**/*.ts"');
  await assertFileContains(root, ".dependency-cruiser.cjs", "NATIVE_HOOK_WRAPPER_ALLOWED_IMPORT");
  await assertFileContains(
    root,
    ".dependency-cruiser.cjs",
    "^\\\\.agents/scripts/hooks/(adapters|runtime)/",
  );

  assertDefined(packageScripts["agents:sync"], "agents:sync script");
  assertUndefined(packageScripts["agents:check"], "agents:check script");
  assertUndefined(packageScripts["test:hooks"], "test:hooks script");
}

async function assertGeneratedAgentsManifest(root: string): Promise<void> {
  const manifest = await readJsonObject(join(root, ".agents/agents-md-manifest.json"));
  assertEqual(manifest["version"], 2, "agents manifest version");
  const generated = manifest["generated"];
  const outputs = objectField(manifest, "outputs");
  const sources = objectField(manifest, "sources");
  const hasFrontendAgents = await Bun.file(join(root, "apps/frontend/AGENTS.md")).exists();
  const hasSourceAgents = await Bun.file(join(root, "src/AGENTS.md")).exists();
  const expectedGenerated = [
    "AGENTS.md",
    ".agents/scripts/hooks/AGENTS.md",
    ".claude/hooks/AGENTS.md",
    ".codex/hooks/AGENTS.md",
    ...(hasFrontendAgents ? ["apps/frontend/AGENTS.md"] : []),
    "scripts/quality/AGENTS.md",
    "scripts/validation/AGENTS.md",
    ...(hasSourceAgents ? ["src/AGENTS.md"] : []),
  ].toSorted((left, right) => left.localeCompare(right));

  assertStringArrayExact(generated, expectedGenerated, "agents manifest generated");
  assertObjectHasKey(outputs, "AGENTS.md", "agents manifest outputs");
  if (hasSourceAgents) {
    assertObjectHasKey(outputs, "src/AGENTS.md", "agents manifest outputs");
  }
  assertObjectHasKey(outputs, ".agents/scripts/hooks/AGENTS.md", "agents manifest outputs");
  assertObjectHasKey(outputs, ".codex/hooks/AGENTS.md", "agents manifest outputs");
  assertObjectHasKey(outputs, ".claude/hooks/AGENTS.md", "agents manifest outputs");
  if (hasFrontendAgents) {
    assertObjectHasKey(outputs, "apps/frontend/AGENTS.md", "agents manifest outputs");
  }
  assertObjectHasKey(outputs, "scripts/quality/AGENTS.md", "agents manifest outputs");
  assertObjectHasKey(outputs, "scripts/validation/AGENTS.md", "agents manifest outputs");
  const rootOutput = objectField(outputs, "AGENTS.md");
  assertEqual(rootOutput["kind"], "root", "AGENTS.md manifest kind");
  assertEqual(rootOutput["sourcePath"], "CLAUDE.md", "AGENTS.md manifest sourcePath");
  if (typeof rootOutput["checksum"] !== "string" || !rootOutput["checksum"].startsWith("sha256-")) {
    throw new Error("Expected AGENTS.md manifest checksum to be sha256-prefixed");
  }
  assertObjectHasKey(sources, "CLAUDE.md", "agents manifest sources");
}

async function assertGeneratedAiStopHookContract(root: string): Promise<void> {
  await runGeneratedProjectScript(
    root,
    `
      import { writeFile } from "node:fs/promises";
      import path from "node:path";
      import { defaultRunCommand } from "./.agents/scripts/hooks/core/command-runner.ts";
      import { runStopValidation } from "./.agents/scripts/hooks/core/stop-validation.ts";

      async function git(args) {
        const result = await defaultRunCommand(["git", ...args], { cwd: process.cwd() });
        if (result.code !== 0) throw new Error(result.stderr || result.stdout);
      }

      await git(["init"]);
      await git(["config", "user.email", "test@example.com"]);
      await git(["config", "user.name", "Test User"]);
      await git(["add", "."]);
      await git(["commit", "--no-verify", "-m", "Initial"]);

      const result = await runStopValidation(
        { agent: "codex", hook: "stop", cwd: process.cwd(), sessionId: "contract", touchedPathCandidates: [] },
        async (command, options) => {
          if (command[0] === "git") return defaultRunCommand(command, options);
          await writeFile(path.join(process.cwd(), "generated-stop-mutation.txt"), "mutated by stop validation\\n");
          return { code: 0, stdout: "", stderr: "" };
        },
      );
      if (!result.blockReason?.includes("Stop validation read-only violation")) {
        throw new Error("Expected generated Stop hook to block read-only violation, got " + result.blockReason);
      }
      if (!result.blockReason.includes("generated-stop-mutation.txt")) {
        throw new Error("Expected read-only violation to list changed path, got " + result.blockReason);
      }
    `,
    "generated AI Stop read-only contract",
  );

  await runGeneratedProjectScript(
    root,
    `
      import { defaultRunCommand } from "./.agents/scripts/hooks/core/command-runner.ts";
      import { runStopValidation } from "./.agents/scripts/hooks/core/stop-validation.ts";

      const noisyOutput = Array.from({ length: 200 }, (_, index) => "wrote file-" + index).join("\\n");
      const result = await runStopValidation(
        { agent: "codex", hook: "stop", cwd: process.cwd(), sessionId: "contract", touchedPathCandidates: [] },
        async (command, options) => {
          if (command[0] === "git") return defaultRunCommand(command, options);
          return {
            code: 2,
            stdout: JSON.stringify({
              protocol: "kitsmith.stop-validation",
              version: 1,
              type: "failure",
              runId: options.env?.["KITSMITH_STOP_RUN_ID"],
              failureKind: "validation_failed",
              step: "typecheck",
              exitCode: 2,
              stdoutTail: noisyOutput,
              stdoutRef: ".agents/tmp/hooks/stop/contract/run/typecheck-stdout.txt",
              actionHint: "Run typecheck outside Stop.",
            }) + "\\n",
            stderr: "",
          };
        },
      );
      if (!result.blockReason?.includes("Stop validation failed in typecheck")) {
        throw new Error("Expected generated Stop hook to report JSONL failure, got " + result.blockReason);
      }
      if (!result.blockReason.includes("stdout: .agents/tmp/hooks/stop/contract/run/typecheck-stdout.txt")) {
        throw new Error("Expected generated Stop hook to reference captured stdout, got " + result.blockReason);
      }
      if (result.blockReason.includes("wrote file-199")) {
        throw new Error("Expected generated Stop hook not to inline noisy raw stdout");
      }
    `,
    "generated AI Stop JSONL feedback contract",
  );

  await runGeneratedProjectScript(
    root,
    `
      import { UnclassifiedStopStepError, runReadOnlyStopSteps } from "./scripts/validation/validate-on-stop.ts";

      const executed = [];
      try {
        runReadOnlyStopSteps(["agents:sync"], process.cwd(), [], (step) => executed.push(step));
      } catch (error) {
        if (!(error instanceof UnclassifiedStopStepError)) {
          throw error;
        }
      }
      if (executed.length > 0) {
        throw new Error("Expected generated Stop validation to refuse unclassified steps before execution");
      }
    `,
    "generated Stop unclassified step contract",
  );
}

async function runGeneratedProjectScript(
  root: string,
  script: string,
  label: string,
): Promise<void> {
  const proc = Bun.spawn([process.execPath, "-e", script], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  if (exit !== 0) {
    throw new Error(`${label} failed:\n${stdout}${stderr}`);
  }
}

async function assertFrontendContract(
  root: string,
  contract: GeneratedProjectContract,
  packageJson: JsonObject,
  packageScripts: JsonObject,
): Promise<void> {
  const { ai, frontend } = contract.shape;
  const projectName = contract.templateContext.projectName;

  if (frontend !== "tanstack") {
    assertPathMissing(root, "apps/frontend");
    await assertFileExcludes(root, "lefthook.yml", "frontend-oxc:");
    await assertFileExcludes(root, "lefthook.yml", "apps/frontend/**/*.{ts,tsx}");
    assertUndefined(packageJson["workspaces"], "workspaces");
    assertUndefined(packageScripts["build"], "root build script");
    return;
  }

  const frontendPackage = await readJsonObject(join(root, "apps/frontend/package.json"));
  const frontendScripts = objectField(frontendPackage, "scripts");
  const frontendDevDependencies = objectField(frontendPackage, "devDependencies");
  const workspaces = packageJson["workspaces"];

  if (!Array.isArray(workspaces) || workspaces.length !== 1 || workspaces[0] !== "apps/*") {
    throw new Error('Expected root workspaces to equal ["apps/*"] for TanStack scenario');
  }
  assertEqual(packageScripts["build"], contract.packageJson.scripts["build"], "root build script");
  assertUndefined(packageScripts["test:e2e"], "test:e2e script");
  assertUndefined(packageScripts["build:frontend"], "build:frontend script");
  assertUndefined(packageScripts["typecheck:frontend"], "typecheck:frontend script");
  if (String(packageScripts["test"]).includes("build")) {
    throw new Error("Expected root test script not to hide frontend build");
  }
  if (String(packageScripts["test"]).includes("test:e2e")) {
    throw new Error("Expected root test script not to hide frontend e2e");
  }

  assertPathExists(root, "apps/frontend/package.json");
  assertPathExists(root, "apps/frontend/src/routes/index.tsx");
  assertPathExists(root, "apps/frontend/src/routes/-index.test.tsx");
  assertPathExists(root, "apps/frontend/src/routeTree.gen.ts");
  assertPathExists(root, "apps/frontend/src/testing/setup.ts");
  assertPathExists(root, "apps/frontend/playwright.config.ts");
  assertPathExists(root, "apps/frontend/e2e/home.spec.ts");
  assertNoExternalPackageExecutorScripts(frontendScripts, "frontend package");
  await assertFileContains(root, "apps/frontend/playwright.config.ts", "--strictPort");
  await assertFileContains(root, "apps/frontend/playwright.config.ts", "bun run --no-install vite");
  await assertFileExcludes(root, "apps/frontend/playwright.config.ts", "bun run dev --");
  await assertFileContains(root, "apps/frontend/playwright.config.ts", "PLAYWRIGHT_PORT");
  await assertFileContains(root, "apps/frontend/playwright.config.ts", "PLAYWRIGHT_REUSE_SERVER");
  await assertFileContains(
    root,
    "apps/frontend/playwright.config.ts",
    "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
  );
  await assertFileContains(root, "apps/frontend/e2e/home.spec.ts", "page.getByRole");
  await assertFileContains(root, "apps/frontend/src/routes/index.tsx", projectName);
  await assertFileContains(root, "apps/frontend/src/routes/index.tsx", "normalized by Kitsmith");
  await assertFileExcludes(root, "apps/frontend/src/routes/index.tsx", "Welcome to TanStack");
  await assertFileContains(root, "lefthook.yml", "frontend-oxc:");
  await assertFileContains(root, "lefthook.yml", '- "apps/frontend/**/*.{ts,tsx}"');
  await assertFileContains(
    root,
    "apps/frontend/.oxlintrc.jsonc",
    '"files": ["vite.config.ts", "playwright.config.ts"]',
  );
  await assertFileContains(root, "apps/frontend/.oxlintrc.jsonc", '"correctness": "error"');
  await assertFileContains(
    root,
    "apps/frontend/tsconfig.node.json",
    '"include": ["vite.config.ts", "playwright.config.ts"]',
  );
  await assertFileContains(
    root,
    "apps/frontend/.oxlintrc.jsonc",
    '"import/no-default-export": "off"',
  );

  if (!contract.frontend.enabled) {
    throw new Error("Expected frontend contract to be enabled for TanStack scenario");
  }

  assertEqual(frontendPackage["name"], contract.frontend.packageJson.name, "frontend package name");
  assertEqual(
    frontendPackage["version"],
    contract.frontend.packageJson.version,
    "frontend package version",
  );
  assertEqual(frontendPackage["type"], contract.frontend.packageJson.type, "frontend package type");
  assertEqual(
    frontendPackage["private"],
    contract.frontend.packageJson.private,
    "frontend package private",
  );
  assertJsonRecordExact(frontendScripts, contract.frontend.packageJson.scripts, "frontend scripts");
  assertObjectHasKey(frontendDevDependencies, "@playwright/test", "frontend devDependencies");
  assertObjectHasKey(
    frontendDevDependencies,
    "@testing-library/jest-dom",
    "frontend devDependencies",
  );
  assertOptionalJsonRecordExact(
    frontendPackage["dependencies"],
    contract.frontend.packageJson.dependencies,
    "frontend dependencies",
  );
  assertJsonRecordExact(
    frontendDevDependencies,
    contract.frontend.packageJson.devDependencies,
    "frontend devDependencies",
  );

  assertPathMissing(root, "apps/frontend/.cta.json");
  assertPathMissing(root, "apps/frontend/.vscode");
  assertPathMissing(root, "apps/frontend/README.md");
  assertPathMissing(root, "apps/frontend/public");
  assertPathMissing(root, "apps/frontend/src/components");
  assertPathMissing(root, "apps/frontend/src/router.tsx");
  assertPathMissing(root, "apps/frontend/src/routes/about.tsx");

  if (ai) {
    assertPathExists(root, ".claude/rules/frontend-code.md");
    assertPathExists(root, "apps/frontend/AGENTS.md");
    assertPathMissing(root, "apps/frontend/src/AGENTS.md");
    assertPathMissing(root, ".claude/rules/frontend-conventions.md");
    await assertFileContains(root, "apps/frontend/AGENTS.md", "TanStack Router");
    await assertFileContains(root, "apps/frontend/AGENTS.md", "routeTree.gen.ts");
  } else {
    assertPathMissing(root, "apps/frontend/AGENTS.md");
    assertPathMissing(root, "apps/frontend/src/AGENTS.md");
  }
}

export async function assertGeneratedProjectContract(
  root: string,
  contract: GeneratedProjectContract,
): Promise<void> {
  assertGeneratedFileSet(root, contract);

  const packageJson = await readJsonObject(join(root, "package.json"));
  const packageScripts = objectField(packageJson, "scripts");

  await assertRootContract(root, contract, packageJson, packageScripts);
  await assertBackendContract(root, contract, packageJson, packageScripts);
  await assertEffectContract(root, contract, packageJson, packageScripts);
  await assertAiContract(root, contract, packageScripts);
  await assertFrontendContract(root, contract, packageJson, packageScripts);
}
