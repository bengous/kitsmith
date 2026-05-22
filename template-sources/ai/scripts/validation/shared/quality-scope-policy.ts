// Generated-project quality scope policy.
// Keep behavior aligned through scripts/validation/shared/quality-scope-policy.test.ts.
export type RoutingWorkspaceKind = "generated-project";

export type RoutingScope = "backend" | "frontend" | "scripts" | "config";

export type RoutingPresence = {
  readonly backend: boolean;
  readonly frontend: boolean;
};

export type RoutingContext = {
  readonly kind: RoutingWorkspaceKind;
  readonly presence: RoutingPresence;
};

export type QualityWorkspace = {
  readonly name: "root" | "codex-hooks" | "frontend";
  readonly oxlintConfig: string;
  readonly oxlintArgs: ReadonlyArray<string>;
  readonly oxfmtConfig: string;
  readonly lint: boolean;
  readonly lintFix: boolean;
  readonly formatMode: "write" | "check";
};

const LINTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
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

export function normalizeRoutingPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function hasLintableExtension(filePath: string): boolean {
  return LINTABLE_EXTENSIONS.has(extensionOf(filePath));
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
    normalized.startsWith(".agents/hooks/") ||
    normalized.startsWith(".codex/hooks/") ||
    normalized.startsWith(".claude/hooks/")
  ) {
    // "scripts" is the generated-project tooling scope, including shared hook code
    // and native harness wrappers, not only the literal scripts/ directory.
    return "scripts";
  }
  if (
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

  if (!hasLintableExtension(normalized)) {
    return null;
  }

  if (normalized.startsWith("src/")) {
    return context.presence.backend ? ROOT_WORKSPACE : null;
  }
  if (
    normalized.startsWith("scripts/") ||
    normalized.startsWith(".agents/hooks/") ||
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
  return null;
}

function extensionOf(filePath: string): string {
  const index = filePath.lastIndexOf(".");
  return index === -1 ? "" : filePath.slice(index);
}
