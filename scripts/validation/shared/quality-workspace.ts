import type { QualityWorkspace, RoutingContext, RoutingPresence } from "./quality-scope-policy.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  hasLintableExtension,
  normalizeRoutingPath,
  resolveQualityWorkspace,
} from "./quality-scope-policy.ts";
import { repoRelativePath, toPosixSeparators } from "./repo-path.ts";

export type Workspace = QualityWorkspace;

export function normalizeTouchedPath(filePath: string, projectRoot = process.cwd()): string {
  return normalizeRoutingPath(
    repoRelativePath(filePath, projectRoot) ?? toPosixSeparators(filePath).replace(/^\.\//, ""),
  );
}

export function hasRoutableExtension(filePath: string): boolean {
  return hasLintableExtension(filePath);
}

function workspacePresence(projectRoot: string): RoutingPresence {
  return {
    backend: existsSync(path.join(projectRoot, "src/index.ts")),
    frontend: existsSync(path.join(projectRoot, "apps/frontend/package.json")),
  };
}

export function resolveGeneratedProjectWorkspace(
  filePath: string,
  projectRoot = process.cwd(),
  presence: RoutingPresence = workspacePresence(projectRoot),
): Workspace | null {
  const normalized = normalizeTouchedPath(filePath, projectRoot);
  const context: RoutingContext = { kind: "generated-project", presence };
  return resolveQualityWorkspace(normalized, context);
}
