import type { RoutingPresence, RoutingScope } from "../shared/quality-scope-policy.ts";
import { $ } from "bun";
import { existsSync } from "node:fs";
import { classifyRoutingPath, expandConfigRoutingScope } from "../shared/quality-scope-policy.ts";

export type Scope = RoutingScope;

type WorkspacePresence = RoutingPresence;

export const CODE_PATTERN = /\.(ts|tsx|js|mjs|cjs|css|html|json|jsonc|md|mdx|toml|ya?ml)$/;

function hasFrontendWorkspace(): boolean {
  return existsSync("apps/frontend/package.json");
}

function hasBackendWorkspace(): boolean {
  return existsSync("src/index.ts");
}

function workspacePresence(): WorkspacePresence {
  return {
    backend: hasBackendWorkspace(),
    frontend: hasFrontendWorkspace(),
  };
}

function classifyFileWithWorkspace(filePath: string, presence: WorkspacePresence): Scope | null {
  return classifyRoutingPath(filePath, { kind: "generated-project", presence });
}

export function classifyFile(filePath: string): Scope | null {
  return classifyFileWithWorkspace(filePath, workspacePresence());
}

export function classifyScopes(files: string[]): Set<Scope> {
  const scopes = new Set<Scope>();
  const presence = workspacePresence();
  for (const file of files) {
    const scope = classifyFileWithWorkspace(file, presence);
    if (scope !== null) {
      scopes.add(scope);
    }
  }
  return scopes;
}

export function expandConfigScope(scopes: Set<Scope>): Set<Scope> {
  const presence = workspacePresence();
  return expandConfigRoutingScope(scopes, {
    kind: "generated-project",
    presence,
  });
}

function parseFileList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export type GitContext = "working" | "staged" | "push";

export async function getChangedFiles(context: GitContext): Promise<string[]> {
  switch (context) {
    case "working": {
      const [unstaged, staged, untracked] = await Promise.all([
        $`git diff --name-only`.nothrow().quiet().text(),
        $`git diff --cached --name-only`.nothrow().quiet().text(),
        $`git ls-files --others --exclude-standard`.nothrow().quiet().text(),
      ]);
      return [
        ...new Set([
          ...parseFileList(unstaged),
          ...parseFileList(staged),
          ...parseFileList(untracked),
        ]),
      ];
    }
    case "staged": {
      return parseFileList(await $`git diff --cached --name-only`.nothrow().quiet().text());
    }
    case "push": {
      const pushResult = await $`git diff --name-only @{push}...HEAD`.nothrow().quiet();
      if (pushResult.exitCode === 0) {
        return parseFileList(pushResult.text());
      }
      return parseFileList(await $`git diff --name-only HEAD~1...HEAD`.nothrow().quiet().text());
    }
    default: {
      throw new Error(`Unsupported git context: ${String(context)}`);
    }
  }
}

export async function getChangedScopes(context: GitContext): Promise<Set<Scope>> {
  return classifyScopes(await getChangedFiles(context));
}
