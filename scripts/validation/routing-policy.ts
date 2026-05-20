// Maintainer source for command-surface routing policy.
// Generated-project copies are projections covered by routing-policy tests.
export type RoutingWorkspaceKind = "live-repo" | "generated-project";

export type RoutingScope = "backend" | "frontend" | "scripts" | "config" | "product";

export type RoutingPresence = {
  readonly backend: boolean;
  readonly frontend: boolean;
};

export type RoutingContext = {
  readonly kind: RoutingWorkspaceKind;
  readonly presence: RoutingPresence;
};

export type QualityWorkspace = {
  readonly name: "root" | "codex-hooks" | "frontend" | "product";
  readonly oxlintConfig: string;
  readonly oxlintArgs: ReadonlyArray<string>;
  readonly oxfmtConfig: string;
  readonly lint: boolean;
  readonly lintFix: boolean;
  readonly formatMode: "write" | "check";
};

const LINTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const FORMATTABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".toml",
  ".html",
  ".css",
]);

const CONFIG_FILES = new Set([
  "tsconfig.json",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  ".oxlintrc.jsonc",
  ".oxfmtrc.jsonc",
  "lefthook.yml",
  ".dependency-cruiser.cjs",
  ".jscpd.json",
  "knip.jsonc",
  "mise.toml",
]);

const ROOT_WORKSPACE: QualityWorkspace = {
  name: "root",
  oxlintConfig: ".oxlintrc.jsonc",
  oxlintArgs: [],
  oxfmtConfig: ".oxfmtrc.jsonc",
  lint: true,
  lintFix: true,
  formatMode: "write",
};

const CODEX_HOOK_WORKSPACE: QualityWorkspace = {
  name: "codex-hooks",
  oxlintConfig: ".oxlintrc.jsonc",
  oxlintArgs: [],
  oxfmtConfig: ".oxfmtrc.jsonc",
  lint: true,
  lintFix: false,
  formatMode: "check",
};

const FRONTEND_WORKSPACE: QualityWorkspace = {
  name: "frontend",
  oxlintConfig: "apps/frontend/.oxlintrc.jsonc",
  oxlintArgs: ["--type-aware"],
  oxfmtConfig: "apps/frontend/.oxfmtrc.jsonc",
  lint: true,
  lintFix: true,
  formatMode: "write",
};

const PRODUCT_WORKSPACE: QualityWorkspace = {
  name: "product",
  oxlintConfig: ".oxlintrc.jsonc",
  oxlintArgs: [],
  oxfmtConfig: ".oxfmtrc.jsonc",
  lint: false,
  lintFix: false,
  formatMode: "write",
};

export function normalizeRoutingPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function hasLintableExtension(filePath: string): boolean {
  return LINTABLE_EXTENSIONS.has(extensionOf(filePath));
}

export function hasFormattableExtension(filePath: string): boolean {
  return FORMATTABLE_EXTENSIONS.has(extensionOf(filePath));
}

export function isProductSurface(filePath: string): boolean {
  const normalized = normalizeRoutingPath(filePath);
  return normalized.startsWith("templates/") || normalized.startsWith("template-sources/");
}

export function requiresGeneratedDependencyCheck(filePath: string): boolean {
  const normalized = normalizeRoutingPath(filePath);
  return (
    normalized === "package.json" ||
    normalized === "bun.lock" ||
    normalized === "src/core/generated-dependencies.generated.ts" ||
    normalized.startsWith("config/generated-dependencies/") ||
    isProductSurface(normalized)
  );
}

export function classifyRoutingPath(
  filePath: string,
  context: RoutingContext,
): RoutingScope | null {
  const normalized = normalizeRoutingPath(filePath);

  if (normalized.startsWith("apps/frontend/") && context.presence.frontend) {
    return "frontend";
  }
  if (normalized.startsWith("src/") && context.presence.backend) {
    return "backend";
  }
  if (
    normalized.startsWith("scripts/") ||
    normalized.startsWith(".agents/scripts/hooks/") ||
    normalized.startsWith(".codex/hooks/") ||
    normalized.startsWith(".claude/hooks/")
  ) {
    return "scripts";
  }
  if (context.kind === "live-repo" && isProductSurface(normalized)) {
    return "product";
  }
  if (
    normalized.startsWith("config/generated-dependencies/") ||
    normalized === ".codex/config.toml" ||
    normalized === ".claude/settings.json" ||
    normalized === ".agents/agents-md-manifest.json" ||
    normalized === "CLAUDE.md" ||
    normalized === "AGENTS.md" ||
    normalized.startsWith(".claude/rules/")
  ) {
    return "config";
  }

  const basename = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  return CONFIG_FILES.has(basename) ? "config" : null;
}

export function expandConfigRoutingScope(
  scopes: Set<RoutingScope>,
  context: RoutingContext,
): Set<RoutingScope> {
  if (!scopes.has("config")) {
    return scopes;
  }

  const expanded = new Set(scopes);
  if (context.presence.backend) {
    expanded.add("backend");
  }
  expanded.add("scripts");
  if (context.kind === "live-repo") {
    expanded.add("product");
  }
  if (context.presence.frontend) {
    expanded.add("frontend");
  }
  return expanded;
}

export function resolveQualityWorkspace(
  filePath: string,
  context: RoutingContext,
): QualityWorkspace | null {
  const normalized = normalizeRoutingPath(filePath);

  if (context.kind === "live-repo") {
    if (!hasFormattableExtension(normalized) && !hasLintableExtension(normalized)) {
      return null;
    }
  } else if (!hasLintableExtension(normalized)) {
    return null;
  }

  if (normalized.startsWith("src/")) {
    return context.presence.backend ? ROOT_WORKSPACE : null;
  }
  if (
    normalized.startsWith("scripts/") ||
    normalized.startsWith(".agents/scripts/hooks/") ||
    normalized.startsWith(".claude/hooks/")
  ) {
    return ROOT_WORKSPACE;
  }
  if (normalized.startsWith(".codex/hooks/")) {
    return CODEX_HOOK_WORKSPACE;
  }
  if (normalized.startsWith("apps/frontend/")) {
    return context.presence.frontend ? FRONTEND_WORKSPACE : null;
  }
  if (context.kind === "live-repo" && isProductSurface(normalized)) {
    return PRODUCT_WORKSPACE;
  }
  return null;
}

function extensionOf(filePath: string): string {
  const index = filePath.lastIndexOf(".");
  return index === -1 ? "" : filePath.slice(index);
}
