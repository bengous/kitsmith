import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectLinkCheckFiles, filesContainLinks } from "./check-links-local.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("filesContainLinks", () => {
  test("returns false for docs without links", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "README.md"), "# Readme\n\nNo links here.");

    expect(filesContainLinks(["README.md"], dir)).toBe(false);
  });

  test("detects markdown and html links", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "README.md"), "[docs](./docs/guide.md)");
    writeFileSync(join(dir, "page.html"), '<a href="/docs">Docs</a>');

    expect(filesContainLinks(["README.md"], dir)).toBe(true);
    expect(filesContainLinks(["page.html"], dir)).toBe(true);
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kitsmith-links-"));
  tempDirs.push(dir);
  return dir;
}

describe("collectLinkCheckFiles", () => {
  test("finds README.md even when git has no tracked files", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "README.md"), "# Readme");
    expect(collectLinkCheckFiles(dir)).toEqual(["README.md"]);
  });

  test("collects fallback documentation and config surfaces recursively", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "docs/nested"), { recursive: true });
    mkdirSync(join(dir, "config/generated-dependencies"), { recursive: true });
    mkdirSync(join(dir, "template-sources/base"), { recursive: true });
    mkdirSync(join(dir, "templates"), { recursive: true });
    writeFileSync(join(dir, "README.md"), "# Readme");
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "docs/guide.md"), "# Guide");
    writeFileSync(join(dir, "docs/nested/index.html"), "<h1>Guide</h1>");
    writeFileSync(join(dir, "config/generated-dependencies/UBIQUITOUS_LANGUAGE.md"), "# Terms");
    writeFileSync(join(dir, "template-sources/base/mise.toml"), "[tools]");
    writeFileSync(join(dir, "templates/package.json.tpl"), "{}");
    writeFileSync(join(dir, "docs/ignore.txt"), "ignore");

    expect(collectLinkCheckFiles(dir)).toEqual([
      "config/generated-dependencies/UBIQUITOUS_LANGUAGE.md",
      "docs/guide.md",
      "docs/nested/index.html",
      "package.json",
      "README.md",
      "template-sources/base/mise.toml",
      "templates/package.json.tpl",
    ]);
  });

  test("uses Git-visible tracked and untracked files while respecting excludes", () => {
    const dir = makeTempDir();
    runGit(dir, "init", "-q");
    mkdirSync(join(dir, "config/generated-dependencies"), { recursive: true });
    mkdirSync(join(dir, "docs"), { recursive: true });
    mkdirSync(join(dir, "templates"), { recursive: true });
    mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });

    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    writeFileSync(join(dir, "README.md"), "# Readme");
    writeFileSync(join(dir, "docs/guide.md"), "# Guide");
    writeFileSync(join(dir, "config/generated-dependencies/UBIQUITOUS_LANGUAGE.md"), "# Terms");
    writeFileSync(join(dir, "templates/package.json.tpl"), "{}");
    writeFileSync(join(dir, "node_modules/pkg/README.md"), "# Vendor");
    writeFileSync(join(dir, "src.ts"), "const url = 'https://example.com';");
    runGit(dir, "add", ".gitignore", "README.md", "docs/guide.md", "templates/package.json.tpl");

    expect(collectLinkCheckFiles(dir)).toEqual([
      "config/generated-dependencies/UBIQUITOUS_LANGUAGE.md",
      "docs/guide.md",
      "README.md",
      "templates/package.json.tpl",
    ]);
  });
});

function runGit(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }
}
