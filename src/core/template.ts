import type { TemplateContext } from "../types.ts";
import type {
  GeneratedProjectContract,
  PackageJsonContract,
} from "./generated-project-contract.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGeneratedProjectContract } from "./generated-project-contract.ts";
import { TEMPLATES_DIR } from "./paths.ts";

const TOKEN_PATTERN = /__([A-Z0-9_]+?)__/g;

const FRONTEND_ROOT_SCRIPT_NAMES = ["build"] as const;

function quoteArray(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function packageJsonForTemplateContext(context: TemplateContext): GeneratedProjectContract {
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

function dependencyBlock(
  name: string,
  dependencies: Readonly<Record<string, string>> | undefined,
): string {
  if (dependencies === undefined) {
    return "";
  }

  const entries = Object.entries(dependencies)
    .map(
      ([packageName, version]) => `    ${JSON.stringify(packageName)}: ${JSON.stringify(version)}`,
    )
    .join(",\n");
  return `  ${JSON.stringify(name)}: {\n${entries}\n  },\n`;
}

function devDependencyEntries(packageJson: PackageJsonContract): string {
  return Object.entries(packageJson.devDependencies)
    .map(
      ([packageName, version]) => `    ${JSON.stringify(packageName)}: ${JSON.stringify(version)}`,
    )
    .join(",\n");
}

function objectEntriesForTemplate(record: Readonly<Record<string, string>>): string {
  return Object.entries(record)
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(",\n");
}

function jsonLines(values: readonly string[], indent: string): string {
  return values.map((value) => `${indent}${JSON.stringify(value)}`).join(",\n");
}

function lefthookGlobLines(globs: readonly string[]): string {
  return globs.map((glob) => `        - ${JSON.stringify(glob)}\n`).join("");
}

function packageTemplateValues(contract: GeneratedProjectContract): Record<string, string> {
  const workspacesBlock =
    contract.packageJson.workspaces === undefined
      ? ""
      : `  "workspaces": [\n    ${contract.packageJson.workspaces.map((workspace) => JSON.stringify(workspace)).join(",\n    ")}\n  ],\n`;

  const binBlock = contract.packageJson.bin
    ? `  "bin": {\n${Object.entries(contract.packageJson.bin)
        .map(([binName, path]) => `    ${JSON.stringify(binName)}: ${JSON.stringify(path)}`)
        .join(",\n")}\n  },\n`
    : "";

  const aiScripts =
    contract.packageJson.scripts["agents:sync"] !== undefined
      ? `    "agents:sync": ${JSON.stringify(contract.packageJson.scripts["agents:sync"])},\n`
      : "";

  return {
    BIN_BLOCK: binBlock,
    DEV_COMMAND: contract.packageJson.scripts["dev"] ?? "",
    TEST_COMMAND: contract.packageJson.scripts["test"] ?? "",
    WORKSPACES_BLOCK: workspacesBlock,
    AI_SCRIPTS: aiScripts,
    ROOT_DEV_DEPENDENCIES: devDependencyEntries(contract.packageJson),
  };
}

function effectTemplateValues(contract: GeneratedProjectContract): Record<string, string> {
  const context = contract.templateContext;
  const effectDependenciesBlock = dependencyBlock(
    "dependencies",
    contract.packageJson.dependencies,
  );

  const effectTsconfigPlugins = context.effect
    ? ',\n    "plugins": [{\n      "name": "@effect/language-service",\n      "diagnostics": true,\n      "quickinfo": true,\n      "completions": true,\n      "ignoreEffectWarningsInTscExitCode": false,\n      "diagnosticSeverity": {\n        "anyUnknownInErrorContext": "warning",\n        "deterministicKeys": "warning",\n        "extendsNativeError": "warning",\n        "importFromBarrel": "warning",\n        "instanceOfSchema": "warning",\n        "missedPipeableOpportunity": "suggestion",\n        "missingEffectServiceDependency": "warning",\n        "nodeBuiltinImport": "off",\n        "schemaUnionOfLiterals": "suggestion",\n        "serviceNotAsClass": "warning",\n        "strictBooleanExpressions": "warning",\n        "strictEffectProvide": "warning"\n      }\n    }]'
    : "";

  return {
    EFFECT_SCRIPTS: "",
    EFFECT_DEPENDENCIES_BLOCK: effectDependenciesBlock,
    EFFECT_DEV_DEPENDENCIES: "",
    EFFECT_TSCONFIG_PLUGINS: effectTsconfigPlugins,
  };
}

function frontendTemplateValues(contract: GeneratedProjectContract): Record<string, string> {
  const frontendScripts = FRONTEND_ROOT_SCRIPT_NAMES.flatMap((scriptName) => {
    const command = contract.packageJson.scripts[scriptName];
    return command === undefined
      ? []
      : [`    ${JSON.stringify(scriptName)}: ${JSON.stringify(command)},\n`];
  }).join("");

  const frontendLefthookCommand = contract.frontend.enabled
    ? `    frontend-oxc:\n      glob:\n        - ${JSON.stringify(contract.frontend.lefthookGlob)}\n      run: ./node_modules/.bin/oxlint --type-aware -c apps/frontend/.oxlintrc.jsonc --fix --quiet --format=unix {staged_files} && ./node_modules/.bin/oxfmt --write -c apps/frontend/.oxfmtrc.jsonc {staged_files}\n      stage_fixed: true\n`
    : "";

  const frontendTypecheckGlob = contract.frontend.enabled
    ? `        - ${JSON.stringify(contract.frontend.lefthookGlob)}\n`
    : "";

  const knipFrontendWorkspace = contract.frontend.enabled
    ? `,\n    "apps/frontend": {\n      "entry": [\n${jsonLines(
        contract.frontend.knipWorkspace.entry,
        "        ",
      )}\n      ],\n      "project": [${quoteArray(contract.frontend.knipWorkspace.project)}]\n    }`
    : "";

  return {
    FRONTEND_SCRIPTS: frontendScripts,
    FRONTEND_LEFTHOOK_COMMAND: frontendLefthookCommand,
    FRONTEND_TYPECHECK_GLOB: frontendTypecheckGlob,
    KNIP_FRONTEND_WORKSPACE: knipFrontendWorkspace,
    FRONTEND_PACKAGE_NAME: contract.frontend.enabled ? contract.frontend.packageJson.name : "",
    FRONTEND_PACKAGE_SCRIPTS: contract.frontend.enabled
      ? objectEntriesForTemplate(contract.frontend.packageJson.scripts)
      : "",
    FRONTEND_PACKAGE_DEPENDENCIES:
      contract.frontend.enabled && contract.frontend.packageJson.dependencies
        ? objectEntriesForTemplate(contract.frontend.packageJson.dependencies)
        : "",
    FRONTEND_PACKAGE_DEV_DEPENDENCIES: contract.frontend.enabled
      ? objectEntriesForTemplate(contract.frontend.packageJson.devDependencies)
      : "",
  };
}

function rootToolingTemplateValues(contract: GeneratedProjectContract): Record<string, string> {
  const rootLefthookExtraGlobs = contract.rootTooling.lefthookRootGlobs.filter(
    (glob) => glob !== "scripts/**/*.ts",
  );

  return {
    ROOT_LINT_PATHS: contract.rootTooling.lintPaths.join(" "),
    ROOT_ARCH_PATHS: contract.rootTooling.archPaths.join(" "),
    ROOT_FORMAT_GLOBS: contract.rootTooling.formatGlobs.join(" "),
    TSCONFIG_INCLUDE: jsonLines(contract.rootTooling.tsconfigInclude, "    "),
    BACKEND_LEFTHOOK_GLOB: lefthookGlobLines(rootLefthookExtraGlobs),
    CODEX_LEFTHOOK_GLOB: "",
    KNIP_ROOT_ENTRY: jsonLines(contract.rootTooling.knipRootEntry, "        "),
    KNIP_ROOT_PROJECT: jsonLines(contract.rootTooling.knipRootProject, "        "),
  };
}

function projectConventionTemplateValues(context: TemplateContext): Record<string, string> {
  const projectConventionPaths = [
    ...(context.backend ? ['  - "src/**/*.ts"'] : []),
    '  - "scripts/**/*.ts"',
  ].join("\n");

  const projectConventionTitle = context.backend
    ? "Backend And Tooling Conventions"
    : "Tooling Script Conventions";

  return {
    PROJECT_CONVENTION_PATHS: projectConventionPaths,
    PROJECT_CONVENTION_TITLE: projectConventionTitle,
  };
}

function readmeCommandLines(contract: GeneratedProjectContract): string {
  return [
    ...(contract.packageJson.scripts["build"] === undefined
      ? []
      : [
          "- `bun run build` - builds the frontend application and writes ignored assets under `apps/frontend/dist`.",
        ]),
    ...(contract.packageJson.scripts["agents:sync"] === undefined
      ? []
      : ["- `bun run agents:sync` - regenerates generated agent instructions from AI sources."]),
  ].join("\n");
}

export function templateValuesFromContract(
  contract: GeneratedProjectContract,
): Record<string, string> {
  const context = contract.templateContext;

  return {
    PROJECT_NAME: context.projectName,
    PACKAGE_NAME: context.packageName,
    BIN_NAME: context.binName,
    BACKEND_ENABLED: String(context.backend),
    FRONTEND_PRESET: context.frontend,
    AI_ENABLED: String(context.ai),
    HAS_WORKSPACES: String(context.hasWorkspaces),
    ...packageTemplateValues(contract),
    ...effectTemplateValues(contract),
    ...frontendTemplateValues(contract),
    ...rootToolingTemplateValues(contract),
    ...projectConventionTemplateValues(context),
    CONDITIONAL_COMMANDS_README: readmeCommandLines(contract),
    AI_GITIGNORE: context.ai ? ".agents/tmp/" : "",
  };
}

export function templateValues(context: TemplateContext): Record<string, string> {
  return templateValuesFromContract(packageJsonForTemplateContext(context));
}

export function renderTemplateFromContract(
  templateName: string,
  contract: GeneratedProjectContract,
): string {
  const raw = readFileSync(join(TEMPLATES_DIR, templateName), "utf8");
  const values = templateValuesFromContract(contract);
  return raw.replace(TOKEN_PATTERN, (_, token: string) => values[token] ?? `__${token}__`);
}

export function renderTemplate(templateName: string, context: TemplateContext): string {
  return renderTemplateFromContract(templateName, packageJsonForTemplateContext(context));
}
