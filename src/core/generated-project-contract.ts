import type { FrontendPreset, InitOptions, TemplateContext } from "../types.ts";
import type { GeneratedDependencySections } from "./generated-dependencies.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveGeneratedDependencySections } from "./generated-dependencies.ts";
import { isJsonObject, parseJsonObject } from "./json.ts";
import { TEMPLATE_SOURCES_DIR } from "./paths.ts";
import { PRESETS } from "./presets.ts";

const PRESET_NAMES = ["base", "frontend-tanstack", "ai", "effect"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

export type ProjectShapeInput = {
  readonly backend: boolean;
  readonly frontend: FrontendPreset;
  readonly ai: boolean;
  readonly effect: boolean;
};

export type ProjectShape = ProjectShapeInput & {
  readonly hasWorkspaces: boolean;
};

export type NativeBootstrapFlags = {
  readonly backend: boolean;
  readonly frontend: boolean;
};

export type PresetCopySpec = {
  readonly name: PresetName;
  readonly sourceDir: string;
  readonly relativePaths: readonly string[];
};

export type TemplateRenderSpec = {
  readonly templateName: string;
  readonly relativePath: string;
};

export type GeneratedFileSpec =
  | {
      readonly owner: "preset";
      readonly presetName: PresetName;
      readonly relativePath: string;
    }
  | {
      readonly owner: "template";
      readonly templateName: string;
      readonly relativePath: string;
    }
  | {
      readonly owner: "finalize";
      readonly relativePath: string;
    };

export type GeneratedProjectDescription = {
  readonly shape: ProjectShape;
  readonly templateContext: TemplateContext;
  readonly nativeBootstrapFlags: NativeBootstrapFlags;
  readonly cleanupPaths: readonly string[];
  readonly presetCopySpecs: readonly PresetCopySpec[];
  readonly templateRenderSpecs: readonly TemplateRenderSpec[];
  readonly generatedFileSpecs: readonly GeneratedFileSpec[];
};

export type PackageJsonContract = {
  readonly name: string;
  readonly version: string;
  readonly type: "module";
  readonly private: true;
  readonly bin?: Readonly<Record<string, string>>;
  readonly workspaces?: readonly string[];
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};

export type RootToolingContract = {
  readonly lintPaths: readonly string[];
  readonly archPaths: readonly string[];
  readonly formatGlobs: readonly string[];
  readonly tsconfigInclude: readonly string[];
  readonly knipRootEntry: readonly string[];
  readonly knipRootProject: readonly string[];
  readonly lefthookRootGlobs: readonly string[];
  readonly lefthookTypecheckGlobs: readonly string[];
};

export type FrontendContract =
  | {
      readonly enabled: false;
    }
  | {
      readonly enabled: true;
      readonly packageJson: PackageJsonContract;
      readonly knipWorkspace: {
        readonly entry: readonly string[];
        readonly project: readonly string[];
      };
      readonly lintPaths: readonly string[];
      readonly archPaths: readonly string[];
      readonly formatPaths: readonly string[];
      readonly cssGlob: string;
      readonly lefthookGlob: string;
    };

export type GeneratedProjectContract = GeneratedProjectDescription & {
  readonly packageJson: PackageJsonContract;
  readonly rootTooling: RootToolingContract;
  readonly frontend: FrontendContract;
};

const BASE_CLEANUP_PATHS = [
  "CLAUDE.md",
  "README.md",
  "index.ts",
  "bun.lock",
  "node_modules",
] as const;

const FRONTEND_CLEANUP_PATHS = [
  "apps/frontend/.cta.json",
  "apps/frontend/.vscode",
  "apps/frontend/README.md",
  "apps/frontend/public",
  "apps/frontend/src/components",
  "apps/frontend/src/router.tsx",
  "apps/frontend/src/routes/about.tsx",
] as const;

const BASE_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  { templateName: "package.json.tpl", relativePath: "package.json" },
  { templateName: "tsconfig.json.tpl", relativePath: "tsconfig.json" },
  { templateName: "knip.jsonc.tpl", relativePath: "knip.jsonc" },
  { templateName: "lefthook.yml.tpl", relativePath: "lefthook.yml" },
  { templateName: ".gitignore.tpl", relativePath: ".gitignore" },
];

const BACKEND_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  { templateName: "src/index.ts.tpl", relativePath: "src/index.ts" },
  { templateName: "src/index.test.ts.tpl", relativePath: "src/index.test.ts" },
];

const EFFECT_BACKEND_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  { templateName: "src/index.effect.ts.tpl", relativePath: "src/index.ts" },
  { templateName: "src/index.effect.test.ts.tpl", relativePath: "src/index.test.ts" },
];

const AI_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  { templateName: "CLAUDE.md.tpl", relativePath: "CLAUDE.md" },
];

const BACKEND_AI_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  {
    templateName: ".claude/rules/source-code.md.tpl",
    relativePath: ".claude/rules/source-code.md",
  },
];

const FRONTEND_AI_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  {
    templateName: ".claude/rules/frontend-code.md.tpl",
    relativePath: ".claude/rules/frontend-code.md",
  },
];

const FRONTEND_TEMPLATE_RENDER_SPECS: readonly TemplateRenderSpec[] = [
  { templateName: "apps/frontend/package.json.tpl", relativePath: "apps/frontend/package.json" },
  { templateName: "apps/frontend/.gitignore.tpl", relativePath: "apps/frontend/.gitignore" },
  { templateName: "apps/frontend/index.html.tpl", relativePath: "apps/frontend/index.html" },
  {
    templateName: "apps/frontend/vite.config.ts.tpl",
    relativePath: "apps/frontend/vite.config.ts",
  },
  {
    templateName: "apps/frontend/playwright.config.ts.tpl",
    relativePath: "apps/frontend/playwright.config.ts",
  },
  {
    templateName: "apps/frontend/src/main.tsx.tpl",
    relativePath: "apps/frontend/src/main.tsx",
  },
  {
    templateName: "apps/frontend/src/routeTree.gen.ts.tpl",
    relativePath: "apps/frontend/src/routeTree.gen.ts",
  },
  {
    templateName: "apps/frontend/src/routes/__root.tsx.tpl",
    relativePath: "apps/frontend/src/routes/__root.tsx",
  },
  {
    templateName: "apps/frontend/src/routes/index.tsx.tpl",
    relativePath: "apps/frontend/src/routes/index.tsx",
  },
  {
    templateName: "apps/frontend/src/routes/-index.test.tsx.tpl",
    relativePath: "apps/frontend/src/routes/-index.test.tsx",
  },
  {
    templateName: "apps/frontend/src/testing/setup.ts.tpl",
    relativePath: "apps/frontend/src/testing/setup.ts",
  },
  {
    templateName: "apps/frontend/e2e/home.spec.ts.tpl",
    relativePath: "apps/frontend/e2e/home.spec.ts",
  },
  {
    templateName: "apps/frontend/src/styles.css.tpl",
    relativePath: "apps/frontend/src/styles.css",
  },
];

type PresetCopyManifest = Record<PresetName, readonly string[]>;

function isPresetName(value: string): value is PresetName {
  return PRESET_NAMES.some((presetName) => presetName === value);
}

function readManifestCopiedPaths(
  manifest: Record<string, unknown>,
  label: string,
  presetName: PresetName,
): readonly string[] {
  const entry = manifest[presetName];
  if (!isJsonObject(entry)) {
    throw new TypeError(`${label} must define object entry "${presetName}"`);
  }

  const copied = entry["copied"];
  if (!Array.isArray(copied)) {
    throw new TypeError(`${label} entry "${presetName}.copied" must be a string array`);
  }

  const paths: string[] = [];
  for (const [index, path] of copied.entries()) {
    if (typeof path !== "string") {
      throw new TypeError(`${label} entry "${presetName}.copied[${index}]" must be a string`);
    }
    paths.push(path);
  }
  return paths;
}

export function parsePresetCopyManifest(raw: string, label: string): PresetCopyManifest {
  const manifest = parseJsonObject(raw, label);

  for (const key of Object.keys(manifest)) {
    if (!isPresetName(key)) {
      throw new TypeError(`${label} contains unknown preset "${key}"`);
    }
  }

  return {
    base: readManifestCopiedPaths(manifest, label, "base"),
    "frontend-tanstack": readManifestCopiedPaths(manifest, label, "frontend-tanstack"),
    ai: readManifestCopiedPaths(manifest, label, "ai"),
    effect: readManifestCopiedPaths(manifest, label, "effect"),
  };
}

const PRESET_COPY_MANIFEST = parsePresetCopyManifest(
  readFileSync(join(TEMPLATE_SOURCES_DIR, "manifest.json"), "utf8"),
  "template-sources/manifest.json",
);

function presetSourceDir(name: PresetName): string {
  const preset = PRESETS.find((candidate) => candidate.name === name);
  if (preset === undefined) {
    throw new Error(`Preset ${name} is not registered`);
  }
  return preset.sourceDir;
}

function presetNamesForShape(shape: ProjectShape): PresetName[] {
  const names: PresetName[] = ["base"];

  if (shape.frontend === "tanstack") {
    names.push("frontend-tanstack");
  }

  if (shape.ai) {
    names.push("ai");
  }

  if (shape.effect) {
    names.push("effect");
  }

  return names;
}

export function resolveProjectShape(input: ProjectShapeInput): ProjectShape {
  if (!input.backend && input.frontend === "none") {
    throw new Error("Backend cannot be disabled without a frontend preset");
  }

  if (!input.backend && input.effect) {
    throw new Error("Effect starter requires the backend preset");
  }

  return {
    backend: input.backend,
    frontend: input.frontend,
    ai: input.ai,
    effect: input.effect,
    hasWorkspaces: input.frontend === "tanstack",
  };
}

function templateContextForOptions(options: InitOptions, shape: ProjectShape): TemplateContext {
  return {
    projectName: options.projectName,
    packageName: options.packageName,
    binName: options.binName,
    backend: shape.backend,
    frontend: shape.frontend,
    ai: shape.ai,
    effect: shape.effect,
    hasWorkspaces: shape.hasWorkspaces,
  };
}

function cleanupPathsForShape(shape: ProjectShape): string[] {
  if (shape.frontend !== "tanstack") {
    return [...BASE_CLEANUP_PATHS];
  }

  return [...BASE_CLEANUP_PATHS, ...FRONTEND_CLEANUP_PATHS];
}

function presetCopySpecsForShape(shape: ProjectShape): PresetCopySpec[] {
  return presetNamesForShape(shape).map((name) => ({
    name,
    sourceDir: presetSourceDir(name),
    relativePaths: PRESET_COPY_MANIFEST[name],
  }));
}

export function templateRenderSpecsForShape(input: ProjectShapeInput): TemplateRenderSpec[] {
  const shape = resolveProjectShape(input);
  const specs: TemplateRenderSpec[] = [...BASE_TEMPLATE_RENDER_SPECS];

  if (shape.backend) {
    specs.push(
      ...(shape.effect ? EFFECT_BACKEND_TEMPLATE_RENDER_SPECS : BACKEND_TEMPLATE_RENDER_SPECS),
    );
  }

  if (shape.ai) {
    specs.push(...AI_TEMPLATE_RENDER_SPECS);
  }

  if (shape.ai && shape.backend) {
    specs.push(...BACKEND_AI_TEMPLATE_RENDER_SPECS);
  }

  if (shape.ai && shape.frontend === "tanstack") {
    specs.push(...FRONTEND_AI_TEMPLATE_RENDER_SPECS);
  }

  if (shape.frontend === "tanstack") {
    specs.push(...FRONTEND_TEMPLATE_RENDER_SPECS);
  }

  return specs;
}

function finalizedFileSpecsForShape(shape: ProjectShape): GeneratedFileSpec[] {
  if (!shape.ai) {
    return [];
  }

  const specs: GeneratedFileSpec[] = [
    { owner: "finalize", relativePath: "AGENTS.md" },
    { owner: "finalize", relativePath: ".agents/agents-md-manifest.json" },
    { owner: "finalize", relativePath: ".agents/scripts/hooks/AGENTS.md" },
    { owner: "finalize", relativePath: ".codex/hooks/AGENTS.md" },
    { owner: "finalize", relativePath: ".claude/hooks/AGENTS.md" },
    { owner: "finalize", relativePath: "scripts/quality/AGENTS.md" },
    { owner: "finalize", relativePath: "scripts/validation/AGENTS.md" },
  ];

  if (shape.backend) {
    specs.push({ owner: "finalize", relativePath: "src/AGENTS.md" });
  }

  if (shape.frontend === "tanstack") {
    specs.push({ owner: "finalize", relativePath: "apps/frontend/AGENTS.md" });
  }

  return specs;
}

function generatedFileSpecsForDescription(
  presetCopySpecs: readonly PresetCopySpec[],
  templateRenderSpecs: readonly TemplateRenderSpec[],
  shape: ProjectShape,
): GeneratedFileSpec[] {
  return [
    ...presetCopySpecs.flatMap((preset) =>
      preset.relativePaths.map((relativePath) => ({
        owner: "preset" as const,
        presetName: preset.name,
        relativePath,
      })),
    ),
    ...templateRenderSpecs.map((template) => ({
      owner: "template" as const,
      templateName: template.templateName,
      relativePath: template.relativePath,
    })),
    ...finalizedFileSpecsForShape(shape),
  ];
}

function commandInWorkspace(workspace: string, script: string): string {
  return `bun run --cwd ${workspace} ${script}`;
}

function devCommandForContext(context: TemplateContext): string {
  return context.backend ? "bun run src/index.ts" : commandInWorkspace("apps/frontend", "dev");
}

function testCommandForContext(context: TemplateContext): string {
  return [
    ...(context.backend ? ["bun test ./src"] : []),
    ...(context.frontend === "tanstack" ? [commandInWorkspace("apps/frontend", "test")] : []),
    ...(context.ai
      ? [
          "bun test ./.agents/scripts/hooks ./.codex/hooks ./.claude/hooks ./.pi/hooks ./.pi/extensions ./scripts/validation",
        ]
      : []),
  ].join(" && ");
}

function packageJsonContractForContext(
  context: TemplateContext,
  rootTooling: RootToolingContract,
  dependencySections: GeneratedDependencySections,
): PackageJsonContract {
  const lintPaths = rootTooling.lintPaths.join(" ");
  const formatGlobs = rootTooling.formatGlobs.join(" ");
  const scripts: Record<string, string> = {
    dev: devCommandForContext(context),
    test: testCommandForContext(context),
    autofix: `oxlint -c .oxlintrc.jsonc --fix ${lintPaths} && oxfmt --write -c .oxfmtrc.jsonc ${formatGlobs}`,
    check: "bun scripts/validation/validate.ts --plan check",
    setup: "bun scripts/setup/bootstrap-git-config.ts && bun scripts/setup/bootstrap-prepare.ts",
    validate: "bun scripts/validation/validate.ts",
  };

  if (context.frontend === "tanstack") {
    scripts["build"] = commandInWorkspace("apps/frontend", "build");
  }

  if (context.ai) {
    scripts["agents:sync"] = "bun scripts/agents/sync-agents-md.ts --write";
  }

  return {
    name: context.packageName,
    version: "0.1.0",
    type: "module",
    private: true,
    ...(context.backend ? { bin: { [context.binName]: "./src/index.ts" } } : {}),
    ...(context.hasWorkspaces ? { workspaces: ["apps/*"] } : {}),
    scripts,
    ...(Object.keys(dependencySections.rootDependencies).length > 0
      ? { dependencies: dependencySections.rootDependencies }
      : {}),
    devDependencies: dependencySections.rootDevDependencies,
  };
}

function rootToolingContractForContext(context: TemplateContext): RootToolingContract {
  const lintPaths = [
    ...(context.backend ? ["src/"] : []),
    "scripts/",
    ...(context.ai
      ? [
          ".agents/scripts/hooks/",
          ".codex/hooks/",
          ".claude/hooks/",
          ".pi/hooks/",
          ".pi/extensions/",
        ]
      : []),
  ];
  const archPaths = [
    ...(context.backend ? ["src"] : []),
    "scripts",
    ...(context.ai
      ? [
          "./.agents/scripts/hooks",
          "./.codex/hooks",
          "./.claude/hooks",
          "./.pi/hooks",
          "./.pi/extensions",
        ]
      : []),
  ];
  const formatGlobs = [
    "'commitlint.config.js'",
    ...(context.backend ? ["'src/**/*.{ts,tsx,js,jsx,mjs}'"] : []),
    "'scripts/**/*.{ts,tsx,js,jsx,mjs}'",
    ...(context.ai
      ? [
          "'.agents/scripts/hooks/**/*.{ts,tsx,js,jsx,mjs}'",
          "'.codex/hooks/**/*.{ts,tsx,js,jsx,mjs}'",
          "'.claude/hooks/**/*.{ts,tsx,js,jsx,mjs}'",
          "'.pi/hooks/**/*.{ts,tsx,js,jsx,mjs}'",
          "'.pi/extensions/**/*.{ts,tsx,js,jsx,mjs}'",
        ]
      : []),
  ];
  const tsconfigInclude = [
    ...(context.backend ? ["src/**/*.ts"] : []),
    "scripts/**/*.ts",
    ...(context.ai
      ? [
          ".agents/scripts/hooks/**/*.ts",
          ".codex/hooks/**/*.ts",
          ".claude/hooks/**/*.ts",
          ".pi/hooks/**/*.ts",
          ".pi/extensions/**/*.ts",
        ]
      : []),
  ];
  const knipRootEntry = [
    ...(context.backend ? ["src/index.ts", "src/**/*.test.ts"] : []),
    "scripts/agents/sync-agents-md.ts",
    "scripts/quality/*.ts",
    "scripts/setup/*.ts",
    "scripts/validation/commit-message.ts",
    "scripts/validation/typecheck-staged.ts",
    "scripts/validation/validate.ts",
    "scripts/validation/validate-on-stop.ts",
    "scripts/validation/validate-push.ts",
    "scripts/validation/shared/**/*.test.ts",
    ...(context.ai
      ? [
          ".agents/scripts/hooks/**/*.test.ts",
          ".claude/hooks/**/*.ts",
          ".codex/hooks/**/*.ts",
          ".pi/hooks/**/*.ts",
          ".pi/extensions/**/*.ts",
        ]
      : []),
  ];
  const knipRootProject = [
    ...(context.backend ? ["src/**/*.ts"] : []),
    "scripts/**/*.ts",
    ...(context.ai
      ? [
          ".agents/scripts/hooks/**/*.ts",
          ".claude/hooks/**/*.ts",
          ".codex/hooks/**/*.ts",
          ".pi/hooks/**/*.ts",
          ".pi/extensions/**/*.ts",
        ]
      : []),
  ];
  const lefthookRootGlobs = [
    "scripts/**/*.ts",
    ...(context.backend ? ["src/**/*.ts"] : []),
    ...(context.ai
      ? [
          ".agents/scripts/hooks/**/*.ts",
          ".codex/hooks/**/*.ts",
          ".claude/hooks/**/*.ts",
          ".pi/hooks/**/*.ts",
          ".pi/extensions/**/*.ts",
        ]
      : []),
  ];
  const lefthookTypecheckGlobs = [
    ...lefthookRootGlobs,
    ...(context.frontend === "tanstack" ? ["apps/frontend/**/*.{ts,tsx}"] : []),
  ];

  return {
    lintPaths,
    archPaths,
    formatGlobs,
    tsconfigInclude,
    knipRootEntry,
    knipRootProject,
    lefthookRootGlobs,
    lefthookTypecheckGlobs,
  };
}

function frontendContractForContext(
  context: TemplateContext,
  dependencySections: GeneratedDependencySections,
): FrontendContract {
  if (context.frontend !== "tanstack") {
    return { enabled: false };
  }

  const lintPaths = ["src/", "e2e/", "vite.config.ts", "playwright.config.ts"];
  const formatPaths = ["src/", "e2e/", "vite.config.ts", "playwright.config.ts"];
  const archPaths = ["src", "e2e", "playwright.config.ts", "vite.config.ts"];

  return {
    enabled: true,
    lintPaths,
    archPaths,
    formatPaths,
    cssGlob: "src/**/*.css",
    lefthookGlob: "apps/frontend/**/*.{ts,tsx}",
    knipWorkspace: {
      entry: [
        "src/main.tsx",
        "src/routes/**/*.{ts,tsx}",
        "src/**/*.{test,spec}.{ts,tsx}",
        "e2e/**/*.ts",
        "playwright.config.ts",
        "vite.config.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "e2e/**/*.ts", "playwright.config.ts", "vite.config.ts"],
    },
    packageJson: {
      name: `@${context.packageName}/frontend`,
      version: "0.0.0",
      type: "module",
      private: true,
      scripts: {
        dev: "vite dev --port 3000",
        build: "vite build && tsc -b --pretty false",
        test: "vitest run --environment jsdom",
        typecheck: "tsc -b --pretty false",
        lint: `oxlint --type-aware -c .oxlintrc.jsonc --format=unix ${lintPaths.join(" ")}`,
        "lint:errors": `oxlint --type-aware -c .oxlintrc.jsonc --quiet --format=unix ${lintPaths.join(
          " ",
        )}`,
        format: `oxfmt --write -c .oxfmtrc.jsonc ${formatPaths.join(" ")}`,
        "format:check": `oxfmt --check -c .oxfmtrc.jsonc ${formatPaths.join(" ")}`,
        "lint:css": 'stylelint "src/**/*.css"',
        autofix: `oxlint --type-aware -c .oxlintrc.jsonc --fix ${lintPaths.join(
          " ",
        )} && oxfmt --write -c .oxfmtrc.jsonc ${formatPaths.join(" ")}`,
        preview: "vite preview",
      },
      dependencies: dependencySections.frontendDependencies,
      devDependencies: dependencySections.frontendDevDependencies,
    },
  };
}

export function buildGeneratedProjectContract(options: InitOptions): GeneratedProjectContract {
  const shape = resolveProjectShape(options);
  const templateContext = templateContextForOptions(options, shape);
  const presetCopySpecs = presetCopySpecsForShape(shape);
  const templateRenderSpecs = templateRenderSpecsForShape(shape);
  const rootTooling = rootToolingContractForContext(templateContext);
  const dependencySections = resolveGeneratedDependencySections(shape);

  return {
    shape,
    templateContext,
    nativeBootstrapFlags: {
      backend: shape.backend,
      frontend: shape.frontend === "tanstack",
    },
    cleanupPaths: cleanupPathsForShape(shape),
    presetCopySpecs,
    templateRenderSpecs,
    generatedFileSpecs: generatedFileSpecsForDescription(
      presetCopySpecs,
      templateRenderSpecs,
      shape,
    ),
    packageJson: packageJsonContractForContext(templateContext, rootTooling, dependencySections),
    rootTooling,
    frontend: frontendContractForContext(templateContext, dependencySections),
  };
}

export function describeGeneratedProject(options: InitOptions): GeneratedProjectDescription {
  const {
    packageJson: _packageJson,
    rootTooling: _rootTooling,
    frontend: _frontend,
    ...description
  } = buildGeneratedProjectContract(options);
  return description;
}
