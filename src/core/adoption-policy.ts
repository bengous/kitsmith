import type { TemplateContext } from "../types.ts";
import type {
  PresetCopySpec,
  PresetName,
  TemplateRenderSpec,
} from "./generated-project-contract.ts";
import type { JsonObject } from "./json.ts";
import { objectField, stringArray } from "./json.ts";

const NON_DIRECTORY_PARENT_CONFLICT = "existing non-directory path";

const PRESET_ADOPTION_REASONS = {
  base: "base tooling file",
  "frontend-tanstack": "frontend preset file",
  ai: "AI tooling file",
  effect: "Effect preset file",
} as const satisfies Record<PresetName, string>;

const TEMPLATE_CREATE_REASONS: Readonly<Record<string, string>> = {
  "README.md": "create Kitsmith README",
  "tsconfig.json": "adopt Kitsmith TypeScript config",
  "knip.jsonc": "adopt Kitsmith dead-code config",
  "lefthook.yml": "adopt Kitsmith Git hooks",
  "CLAUDE.md": "create Claude guidance",
  ".claude/rules/project-conventions.md": "create Kitsmith Claude project convention rule",
  ".claude/rules/frontend-conventions.md": "create Kitsmith Claude frontend convention rule",
  ".claude/rules/source-code.md": "create Kitsmith Claude source code convention rule",
  ".claude/rules/frontend-code.md": "create Kitsmith Claude frontend convention rule",
  "apps/frontend/package.json": "create TanStack frontend package",
  "apps/frontend/index.html": "create TanStack frontend entry HTML",
  "apps/frontend/vite.config.ts": "create TanStack frontend Vite config",
  "apps/frontend/playwright.config.ts": "create TanStack frontend Playwright config",
  "apps/frontend/src/main.tsx": "create TanStack frontend entrypoint",
  "apps/frontend/src/routeTree.gen.ts": "seed TanStack route tree",
  "apps/frontend/src/routes/__root.tsx": "create TanStack root route",
  "apps/frontend/src/routes/index.tsx": "create TanStack index route",
  "apps/frontend/src/routes/-index.test.tsx": "create TanStack route test",
  "apps/frontend/src/testing/setup.ts": "create TanStack frontend test setup",
  "apps/frontend/e2e/home.spec.ts": "create TanStack frontend e2e test",
  "apps/frontend/src/styles.css": "create TanStack frontend styles",
};

export type AdoptionTemplatePolicy =
  | {
      readonly kind: "package-json";
    }
  | {
      readonly kind: "skip";
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly kind: "preserve-existing";
      readonly path: string;
      readonly createReason: string;
      readonly preserveReason: string;
    }
  | {
      readonly kind: "create-or-conflict";
      readonly path: string;
      readonly createReason: string;
      readonly conflictReason: string;
    };

export function shouldOmitPresetDuringAdopt(
  spec: PresetCopySpec,
  hasExistingFrontend: boolean,
): boolean {
  return hasExistingFrontend && spec.name === "frontend-tanstack";
}

export function shouldOmitTemplateDuringAdopt(
  spec: TemplateRenderSpec,
  hasExistingFrontend: boolean,
): boolean {
  return hasExistingFrontend && spec.relativePath.startsWith("apps/frontend/");
}

export function frontendConflictReason(): string {
  return "Existing frontend detected; Kitsmith does not convert frontends in adopt v1";
}

export function presetAdoptionReason(name: PresetName): string {
  return PRESET_ADOPTION_REASONS[name];
}

export function isNonDirectoryParentConflict(reason: string): boolean {
  return reason.includes(NON_DIRECTORY_PARENT_CONFLICT);
}

export function presetMismatchPolicy(
  path: string,
  reason: string,
  mismatchReason: string,
): { readonly kind: "skip" | "conflict"; readonly reason: string } {
  if (path.startsWith(".codex/") && isNonDirectoryParentConflict(mismatchReason)) {
    return {
      kind: "skip",
      reason: "Existing .codex path is not a directory; Codex config preserved and skipped",
    };
  }

  if (isNonDirectoryParentConflict(mismatchReason)) {
    return {
      kind: "conflict",
      reason: mismatchReason,
    };
  }

  return {
    kind: "conflict",
    reason: `Existing file differs from Kitsmith ${reason}`,
  };
}

export function adoptionTemplatePolicy(spec: TemplateRenderSpec): AdoptionTemplatePolicy {
  if (spec.relativePath === "package.json") {
    return { kind: "package-json" };
  }

  if (spec.relativePath === "src/index.ts" || spec.relativePath === "src/index.test.ts") {
    return {
      kind: "skip",
      path: spec.relativePath,
      reason: "Existing project source preserved; Kitsmith starter source skipped",
    };
  }

  const path = templateAdoptionPath(spec);
  const createReason = templateCreateReason(spec);

  if (shouldPreserveExistingTemplate(spec)) {
    return {
      kind: "preserve-existing",
      path,
      createReason,
      preserveReason: templatePreserveReason(spec),
    };
  }

  return {
    kind: "create-or-conflict",
    path,
    createReason,
    conflictReason: `Existing file needs review before ${createReason}`,
  };
}

export function mergeAdoptedPackageJson(
  existing: JsonObject,
  expected: JsonObject,
  context: TemplateContext,
): JsonObject {
  return mergePackageJson(existing, withAdoptionPackageScripts(expected, context));
}

function withAdoptionPackageScripts(expected: JsonObject, context: TemplateContext): JsonObject {
  if (!context.ai) {
    return expected;
  }

  return {
    ...expected,
    scripts: {
      ...objectField(expected, "scripts"),
      "agents:sync": "bun scripts/agents/sync-agents-md.ts --write --preserve-root",
    },
  };
}

function mergePackageJson(existing: JsonObject, expected: JsonObject): JsonObject {
  return {
    ...existing,
    scripts: mergeObjectsPreservingExisting(
      objectField(existing, "scripts"),
      objectField(expected, "scripts"),
    ),
    dependencies: mergeObjectsPreservingExisting(
      objectField(existing, "dependencies"),
      objectField(expected, "dependencies"),
    ),
    devDependencies: mergeObjectsPreservingExisting(
      objectField(existing, "devDependencies"),
      objectField(expected, "devDependencies"),
    ),
    workspaces: mergeStringArrayPreservingExisting(existing["workspaces"], expected["workspaces"]),
  };
}

function mergeObjectsPreservingExisting(existing: JsonObject, additions: JsonObject): JsonObject {
  const merged: JsonObject = { ...existing };
  for (const [key, value] of Object.entries(additions)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeStringArrayPreservingExisting(existing: unknown, additions: unknown): unknown {
  if (!Array.isArray(existing) || !Array.isArray(additions)) {
    return existing ?? additions;
  }
  return [...new Set([...stringArray(existing), ...stringArray(additions)])];
}

function templateAdoptionPath(spec: TemplateRenderSpec): string {
  if (spec.relativePath === ".claude/rules/project-conventions.md") {
    return ".claude/rules/kitsmith-project-conventions.md";
  }

  if (spec.relativePath === ".claude/rules/frontend-conventions.md") {
    return ".claude/rules/kitsmith-frontend-conventions.md";
  }

  return spec.relativePath;
}

function templateCreateReason(spec: TemplateRenderSpec): string {
  return (
    TEMPLATE_CREATE_REASONS[spec.relativePath] ??
    `create Kitsmith template output from ${spec.templateName}`
  );
}

function templatePreserveReason(spec: TemplateRenderSpec): string {
  switch (spec.relativePath) {
    case "CLAUDE.md":
      return "Existing Claude/root guidance preserved";
    case ".claude/rules/project-conventions.md":
      return "Existing Kitsmith Claude project convention rule preserved";
    case ".claude/rules/frontend-conventions.md":
      return "Existing Kitsmith Claude frontend convention rule preserved";
    default:
      return "Existing project file preserved";
  }
}

function shouldPreserveExistingTemplate(spec: TemplateRenderSpec): boolean {
  return (
    spec.relativePath === "CLAUDE.md" ||
    spec.relativePath === ".claude/rules/project-conventions.md" ||
    spec.relativePath === ".claude/rules/frontend-conventions.md"
  );
}
