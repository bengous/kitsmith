import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const generatedPathPatterns = [/^\.agents\/agents-md-manifest\.json$/];
const generatedAgentPathFallbackPatterns = [/^(?:.+\/)?AGENTS\.md$/];

export function forbiddenTouchedPaths(paths: readonly string[], root = process.cwd()): string[] {
  const manifestGeneratedPaths = generatedAgentPathsFromManifest(root);
  return paths.filter(
    (filePath) =>
      manifestGeneratedPaths.paths.has(filePath) ||
      generatedPathPatterns.some((pattern) => pattern.test(filePath)) ||
      (manifestGeneratedPaths.useFallbackPatterns &&
        generatedAgentPathFallbackPatterns.some((pattern) => pattern.test(filePath))),
  );
}

export function generatedPathMessage(paths: readonly string[]): string {
  return `Generated files must not be edited directly: ${paths.join(
    ", ",
  )}. Edit CLAUDE.md or .claude/rules/*.md, then run bun run agents:sync.`;
}

function generatedAgentPathsFromManifest(root: string): {
  readonly paths: ReadonlySet<string>;
  readonly useFallbackPatterns: boolean;
} {
  const manifestPath = path.join(root, ".agents", "agents-md-manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      paths: new Set(["AGENTS.md"]),
      useFallbackPatterns: true,
    };
  }

  const parsed = parseJsonObject(readFileSync(manifestPath, "utf8"));
  if (parsed === null) {
    return {
      paths: new Set(["AGENTS.md", ".agents/agents-md-manifest.json"]),
      useFallbackPatterns: true,
    };
  }

  const generated = stringArray(parsed["generated"]);
  const outputs = isRecord(parsed["outputs"]) ? Object.keys(parsed["outputs"]) : [];
  return {
    paths: new Set([...generated, ...outputs, ".agents/agents-md-manifest.json"]),
    useFallbackPatterns: false,
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
