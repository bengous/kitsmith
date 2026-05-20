import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonObject, stringArray } from "../../src/core/json.ts";
import {
  generatedPathsFromManifest as generatedPresetPathsFromManifest,
  parsePaths as generatedPresetParsePaths,
} from "../../template-sources/ai/scripts/agents/sync-agents-md.ts";
import {
  buildManifest,
  fileContainsCrlf,
  generateLayerAgentsMd,
  generatedPathsFromManifest,
  managedPathRegularFileError,
  normalizeNewlines,
  parsePaths,
  pathIsSymlink,
  stripFrontmatter,
  verifyLayerContent,
} from "./sync-agents-md";

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("parsePaths", () => {
  test("extracts single directory", () => {
    const content = `---\npaths:\n  - "src/hooks/**/*.ts"\n---\n# Hook rules`;
    expect(parsePaths(content)).toEqual(["src/hooks"]);
  });

  test("extracts multiple directories (cross-cutting)", () => {
    const content = `---\npaths:\n  - "src/hooks/**/*.ts"\n  - "src/domain/**/*.ts"\n---\n`;
    expect(parsePaths(content)).toEqual(["src/hooks", "src/domain"]);
  });

  test("returns empty for missing frontmatter", () => {
    expect(parsePaths("# No frontmatter here")).toEqual([]);
  });

  test("returns empty for frontmatter without paths", () => {
    const content = `---\nname: test\n---\n# Content`;
    expect(parsePaths(content)).toEqual([]);
  });

  test("extracts any directory prefix before wildcard", () => {
    const content = `---\npaths:\n  - "lib/utils/**/*.ts"\n  - "src/hooks/**/*.ts"\n---\n`;
    expect(parsePaths(content)).toEqual(["lib/utils", "src/hooks"]);
  });

  test("extracts scripts directory paths", () => {
    const content = `---\npaths:\n  - "scripts/setup/**"\n---\n`;
    expect(parsePaths(content)).toEqual(["scripts/setup"]);
  });

  test("extracts root-level scripts path from broad glob", () => {
    const content = `---\npaths:\n  - "scripts/**/*.ts"\n---\n`;
    expect(parsePaths(content)).toEqual(["scripts"]);
  });

  test("deduplicates when multiple paths resolve to same directory", () => {
    const content = `---\npaths:\n  - "scripts/**/*.ts"\n  - "scripts/**/*.sh"\n---\n`;
    expect(parsePaths(content)).toEqual(["scripts"]);
  });

  test("ignores bare glob with no directory prefix", () => {
    const content = `---\npaths:\n  - "**/*.ts"\n---\n`;
    expect(parsePaths(content)).toEqual([]);
  });

  test("supports CRLF frontmatter", () => {
    const content = `---\r\npaths:\r\n  - "src/hooks/**/*.ts"\r\n---\r\n`;
    expect(parsePaths(content)).toEqual(["src/hooks"]);
  });

  test("normalizes Windows path separators from frontmatter", () => {
    const content = `---\npaths:\n  - "src\\hooks\\**\\*.ts"\n---\n`;
    expect(parsePaths(content)).toEqual(["src/hooks"]);
  });

  test("generated preset normalizes Windows path separators from frontmatter", () => {
    const content = `---\npaths:\n  - "src\\hooks\\**\\*.ts"\n---\n`;
    expect(generatedPresetParsePaths(content)).toEqual(["src/hooks"]);
  });
});

describe("stripFrontmatter", () => {
  test("removes YAML frontmatter", () => {
    const content = `---\npaths:\n  - "src/hooks/**/*.ts"\n---\n\n## Hooks Layer\n\nContent here.`;
    expect(stripFrontmatter(content)).toBe("## Hooks Layer\n\nContent here.");
  });

  test("returns content unchanged when no frontmatter", () => {
    const content = "## Just content\n\nNo frontmatter.";
    expect(stripFrontmatter(content)).toBe(content);
  });

  test("handles frontmatter with trailing newline", () => {
    const content = `---\nfoo: bar\n---\n## Title`;
    expect(stripFrontmatter(content)).toBe("## Title");
  });

  test("handles CRLF frontmatter", () => {
    const content = `---\r\nfoo: bar\r\n---\r\n\r\n## Title\r\n`;
    expect(stripFrontmatter(content)).toBe("## Title\n");
  });
});

describe("newline and file helpers", () => {
  test("normalizes CRLF to LF", () => {
    expect(normalizeNewlines("a\r\nb\r\n")).toBe("a\nb\n");
  });

  test("reports managed AGENTS.md symlinks without creating a symlink", () => {
    // Windows blocks symlink creation unless Developer Mode or admin is enabled.
    // Keep the policy covered even when the real filesystem capability test is skipped.
    expect(managedPathRegularFileError("AGENTS.md", true)).toBe(
      "AGENTS.md: symlinks are not allowed for managed AGENTS.md files",
    );
    expect(managedPathRegularFileError("AGENTS.md", false)).toBeNull();
  });
});

describe("manifest metadata", () => {
  test("builds v2 output metadata with checksums and source paths", () => {
    const manifest = buildManifest({
      generated: new Map([
        ["AGENTS.md", "## Root\n"],
        ["src/AGENTS.md", "## Src\n"],
      ]),
      sourceContentByPath: new Map([
        ["CLAUDE.md", "## Root\n"],
        [".claude/rules/src.md", "## Src source\n"],
      ]),
      outputSourceByPath: new Map([
        ["AGENTS.md", "CLAUDE.md"],
        ["src/AGENTS.md", ".claude/rules/src.md"],
      ]),
      targetPaths: new Set(["AGENTS.md", "src/AGENTS.md"]),
    });

    expect(manifest.version).toBe(2);
    expect(manifest.generated).toEqual(["AGENTS.md", "src/AGENTS.md"]);
    expect(manifest.outputs?.["AGENTS.md"]?.kind).toBe("root");
    expect(manifest.outputs?.["AGENTS.md"]?.sourcePath).toBe("CLAUDE.md");
    expect(manifest.outputs?.["src/AGENTS.md"]?.kind).toBe("layer");
    expect(manifest.outputs?.["src/AGENTS.md"]?.sourcePath).toBe(".claude/rules/src.md");
    expect(manifest.outputs?.["AGENTS.md"]?.checksum).toStartWith("sha256-");
    expect(manifest.sources?.["CLAUDE.md"]?.checksum).toStartWith("sha256-");
  });

  test("reads generated paths from the v2 manifest generated list", () => {
    expect(
      generatedPathsFromManifest({
        version: 2,
        generated: ["AGENTS.md", "scripts\\AGENTS.md"],
        outputs: {},
        sources: {},
      }),
    ).toEqual(["AGENTS.md", "scripts/AGENTS.md"]);
  });

  test("generated preset normalizes manifest paths", () => {
    expect(
      generatedPresetPathsFromManifest({
        version: 2,
        generated: ["AGENTS.md", "scripts\\AGENTS.md"],
        outputs: {},
        sources: {},
      }),
    ).toEqual(["AGENTS.md", "scripts/AGENTS.md"]);
  });
});

describe("generateLayerAgentsMd", () => {
  test("produces rules only (no root content)", () => {
    const result = generateLayerAgentsMd([
      { name: "alpha.md", body: "## Alpha\n\nAlpha content." },
    ]);
    expect(result).toStartWith("## Alpha");
    expect(result).not.toContain("---");
  });

  test("handles empty rules list", () => {
    const result = generateLayerAgentsMd([]);
    expect(result).toBe("");
  });

  test("includes multiple rules in order", () => {
    const result = generateLayerAgentsMd([
      { name: "a.md", body: "## A" },
      { name: "b.md", body: "## B" },
    ]);
    const aPos = result.indexOf("## A");
    const bPos = result.indexOf("## B");
    expect(aPos).toBeLessThan(bPos);
  });

  test("ends with newline", () => {
    const result = generateLayerAgentsMd([{ name: "a.md", body: "## A" }]);
    expect(result.endsWith("\n")).toBe(true);
  });

  test("contains no HTML comments", () => {
    const result = generateLayerAgentsMd([{ name: "a.md", body: "## A" }]);
    expect(result).not.toContain("<!--");
  });
});

describe("verifyLayerContent", () => {
  test("returns no errors for correct content", () => {
    const rules = [{ name: "a.md", body: "## Alpha\n\nContent." }];
    const dirToRules = new Map([["src/layerA", rules]]);
    const generated = generateLayerAgentsMd(rules);
    const agentsFiles = new Map([["src/layerA/AGENTS.md", generated]]);

    const errors = verifyLayerContent(dirToRules, agentsFiles);
    expect(errors).toHaveLength(0);
  });

  test("detects missing rule content", () => {
    const rulesInMap = [
      { name: "a.md", body: "## Alpha" },
      { name: "b.md", body: "## Beta" },
    ];
    const dirToRules = new Map([["src/layerA", rulesInMap]]);
    const partial = generateLayerAgentsMd([rulesInMap[0]!]);
    const agentsFiles = new Map([["src/layerA/AGENTS.md", partial]]);

    const errors = verifyLayerContent(dirToRules, agentsFiles);
    expect(errors.some((e) => e.includes("missing rule content from b.md"))).toBe(true);
  });

  test("works with scripts directory paths", () => {
    const rules = [{ name: "scripts-rule.md", body: "## Scripts Rule" }];
    const dirToRules = new Map([["scripts/setup", rules]]);
    const generated = generateLayerAgentsMd(rules);
    const agentsFiles = new Map([["scripts/setup/AGENTS.md", generated]]);

    const errors = verifyLayerContent(dirToRules, agentsFiles);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration tests (sandbox)
// ---------------------------------------------------------------------------

const SCRIPT_PATH = `${import.meta.dir}/sync-agents-md.ts`;

function canCreateFileSymlink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "kitsmith-symlink-capability-"));
  const target = join(dir, "target.md");
  const link = join(dir, "link.md");

  try {
    writeFileSync(target, "target\n");
    symlinkSync("target.md", link, "file");
    return lstatSync(link).isSymbolicLink();
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const canCreateSymlinks = canCreateFileSymlink();

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "etch-sync-test-"));
}

async function removeTempDir(dir: string): Promise<void> {
  await $`rm -rf ${dir}`.quiet();
}

function runScript(
  cwd: string,
  ...args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", SCRIPT_PATH, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

async function scaffoldProject(dir: string): Promise<void> {
  await Bun.write(`${dir}/CLAUDE.md`, "## Test Project\n\nRoot content here.\n");

  await Bun.write(
    `${dir}/.claude/rules/alpha.md`,
    `---\npaths:\n  - "src/layerA/**/*.ts"\n---\n\n## Alpha Rule\n\nAlpha content.\n`,
  );
  await Bun.write(
    `${dir}/.claude/rules/beta.md`,
    `---\npaths:\n  - "src/layerB/**/*.ts"\n---\n\n## Beta Rule\n\nBeta content.\n`,
  );
  await Bun.write(
    `${dir}/.claude/rules/shared.md`,
    `---\npaths:\n  - "src/layerA/**/*.ts"\n  - "src/layerB/**/*.ts"\n---\n\n## Shared Rule\n\nShared content.\n`,
  );

  await Bun.write(
    `${dir}/.claude/rules/scripts-rule.md`,
    `---\npaths:\n  - "scripts/tools/**/*.ts"\n---\n\n## Scripts Rule\n\nScripts content.\n`,
  );

  await $`mkdir -p ${dir}/src/layerA ${dir}/src/layerB ${dir}/src/layerC ${dir}/scripts/tools`.quiet();
}

describe("integration: sandbox project", () => {
  let dir: string;

  beforeAll(async () => {
    dir = makeTempDir();
    await scaffoldProject(dir);
  });

  afterAll(async () => {
    await removeTempDir(dir);
  });

  test("--write creates root, src layer, and scripts AGENTS.md files", () => {
    const { exitCode, stdout } = runScript(dir, "--write");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("AGENTS.md");
    expect(stdout).toContain("src/layerA/AGENTS.md");
    expect(stdout).toContain("src/layerB/AGENTS.md");
    expect(stdout).not.toContain("src/layerC/AGENTS.md");
    expect(stdout).toContain("scripts/tools/AGENTS.md");
    expect(stdout).toContain(".agents/agents-md-manifest.json");
  });

  test("--check exits 0 after --write", () => {
    const { exitCode } = runScript(dir, "--check");
    expect(exitCode).toBe(0);
  });

  test("--check rejects manifests without the v2 metadata contract", async () => {
    await Bun.write(
      `${dir}/.agents/agents-md-manifest.json`,
      JSON.stringify({ generated: ["AGENTS.md"] }, null, "\t"),
    );

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("invalid manifest shape");

    runScript(dir, "--write");
  });

  test("root AGENTS.md mirrors CLAUDE.md", async () => {
    const claudeMd = await Bun.file(`${dir}/CLAUDE.md`).text();
    const agentsMd = await Bun.file(`${dir}/AGENTS.md`).text();
    expect(agentsMd).toBe(claudeMd);
    expect(await pathIsSymlink(`${dir}/AGENTS.md`)).toBe(false);
  });

  test("layer files do NOT contain root content", async () => {
    const layerA = await Bun.file(`${dir}/src/layerA/AGENTS.md`).text();
    expect(layerA).not.toContain("## Test Project");
    expect(layerA).not.toContain("Root content here");
  });

  test("cross-cutting rule appears in both targeted dirs", async () => {
    const layerA = await Bun.file(`${dir}/src/layerA/AGENTS.md`).text();
    const layerB = await Bun.file(`${dir}/src/layerB/AGENTS.md`).text();
    expect(layerA).toContain("## Shared Rule");
    expect(layerB).toContain("## Shared Rule");
  });

  test("layerA AGENTS.md contains alpha + shared rules only", async () => {
    const content = await Bun.file(`${dir}/src/layerA/AGENTS.md`).text();
    expect(content).toContain("## Alpha Rule");
    expect(content).toContain("## Shared Rule");
    expect(content).not.toContain("## Beta Rule");
  });

  test("scripts/tools AGENTS.md contains scripts rule only", async () => {
    const content = await Bun.file(`${dir}/scripts/tools/AGENTS.md`).text();
    expect(content).toContain("## Scripts Rule");
    expect(content).not.toContain("## Alpha Rule");
    expect(content).not.toContain("## Test Project");
  });

  test("layerB AGENTS.md contains beta + shared rules only", async () => {
    const content = await Bun.file(`${dir}/src/layerB/AGENTS.md`).text();
    expect(content).toContain("## Beta Rule");
    expect(content).toContain("## Shared Rule");
    expect(content).not.toContain("## Alpha Rule");
  });

  test("manifest lists all generated files including root and scripts", async () => {
    const manifest = await readJsonObject(`${dir}/.agents/agents-md-manifest.json`);
    const generated = stringArray(manifest["generated"]);
    expect(generated).toContain("AGENTS.md");
    expect(generated).toContain("src/layerA/AGENTS.md");
    expect(generated).toContain("src/layerB/AGENTS.md");
    expect(generated).toContain("scripts/tools/AGENTS.md");
    expect(manifest["version"]).toBe(2);
    expect(JSON.stringify(manifest["outputs"])).toContain('"kind"');
    expect(JSON.stringify(manifest["outputs"])).toContain('"checksum"');
    expect(JSON.stringify(manifest["outputs"])).toContain('"sourcePath"');
    expect(JSON.stringify(manifest["sources"])).toContain("CLAUDE.md");
  });

  test("--check detects drift after rule modification", async () => {
    await Bun.write(
      `${dir}/.claude/rules/alpha.md`,
      `---\npaths:\n  - "src/layerA/**/*.ts"\n---\n\n## Alpha Rule\n\nModified content.\n`,
    );

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("content drift");

    // Restore and re-sync
    await Bun.write(
      `${dir}/.claude/rules/alpha.md`,
      `---\npaths:\n  - "src/layerA/**/*.ts"\n---\n\n## Alpha Rule\n\nAlpha content.\n`,
    );
    runScript(dir, "--write");
  });

  test("--check detects missing AGENTS.md", () => {
    unlinkSync(`${dir}/src/layerA/AGENTS.md`);

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing");

    // Restore
    runScript(dir, "--write");
  });

  test("--check detects stale file via manifest", async () => {
    // Manually add layerC to manifest (simulating a rule that was removed)
    const manifest = await readJsonObject(`${dir}/.agents/agents-md-manifest.json`);
    const generated = [...stringArray(manifest["generated"]), "src/layerC/AGENTS.md"];
    const nextManifest = { ...manifest, generated };
    await Bun.write(
      `${dir}/.agents/agents-md-manifest.json`,
      JSON.stringify(nextManifest, null, "\t"),
    );
    await Bun.write(`${dir}/src/layerC/AGENTS.md`, "# Old generated content\n");

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("stale");

    // Restore
    unlinkSync(`${dir}/src/layerC/AGENTS.md`);
    runScript(dir, "--write");
  });

  test("--check detects root AGENTS.md drift from CLAUDE.md", async () => {
    await Bun.write(`${dir}/AGENTS.md`, "# Tampered root\n");

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("AGENTS.md");
    expect(stderr).toContain("content drift");

    // Restore
    runScript(dir, "--write");
  });

  test("--check rejects CRLF in managed output", async () => {
    await Bun.write(`${dir}/AGENTS.md`, "line1\r\nline2\r\n");
    expect(await fileContainsCrlf(`${dir}/AGENTS.md`)).toBe(true);

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must use LF line endings");

    runScript(dir, "--write");
  });

  test.if(canCreateSymlinks)("--check rejects symlinked managed AGENTS files", () => {
    unlinkSync(`${dir}/AGENTS.md`);
    symlinkSync("CLAUDE.md", `${dir}/AGENTS.md`, "file");
    expect(lstatSync(`${dir}/AGENTS.md`).isSymbolicLink()).toBe(true);

    const { exitCode, stderr } = runScript(dir, "--check");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("symlinks are not allowed");

    unlinkSync(`${dir}/AGENTS.md`);
    runScript(dir, "--write");
  });
});

describe.if(canCreateSymlinks)("integration: preserve root mode", () => {
  let dir: string;

  beforeAll(async () => {
    dir = makeTempDir();
    await Bun.write(`${dir}/AI.md`, "## Existing Root\n\nProject-specific guidance.\n");
    symlinkSync("AI.md", `${dir}/CLAUDE.md`, "file");
    symlinkSync("AI.md", `${dir}/AGENTS.md`, "file");
    await Bun.write(
      `${dir}/.claude/rules/kitsmith-project-conventions.md`,
      `---\npaths:\n  - "src/**/*.ts"\n---\n\n## Kitsmith Rule\n\nAdopted rule content.\n`,
    );
    await $`mkdir -p ${dir}/src`.quiet();
  });

  afterAll(async () => {
    await removeTempDir(dir);
  });

  test("--write --preserve-root keeps existing root AGENTS.md symlink", async () => {
    const { exitCode, stdout, stderr } = runScript(dir, "--write", "--preserve-root");

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("wrote AGENTS.md");
    expect(stdout).toContain("wrote src/AGENTS.md");
    expect(await pathIsSymlink(`${dir}/AGENTS.md`)).toBe(true);
    expect(await Bun.file(`${dir}/AI.md`).text()).toBe(
      "## Existing Root\n\nProject-specific guidance.\n",
    );
  });

  test("--check --preserve-root accepts existing root AGENTS.md symlink", async () => {
    const { exitCode, stderr } = runScript(dir, "--check", "--preserve-root");

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  test("preserve-root manifest only lists generated managed files", async () => {
    const manifest = await readJsonObject(`${dir}/.agents/agents-md-manifest.json`);
    const generated = stringArray(manifest["generated"]);

    expect(generated).not.toContain("AGENTS.md");
    expect(generated).toContain("src/AGENTS.md");
  });
});
