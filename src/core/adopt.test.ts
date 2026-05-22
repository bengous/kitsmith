import type { AdoptOptions } from "../types.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brandValue } from "../types.ts";
import {
  applyAdoptionPlan,
  buildAdoptionPlan,
  deriveAdoptOptions,
  formatAdoptionPlan,
  rollbackAdoption,
} from "./adopt.ts";
import { toExistingBinName, toExistingPackageName, toProjectName } from "./naming.ts";

const tempDirs: string[] = [];

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

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kitsmith-adopt-test-"));
  tempDirs.push(dir);
  return dir;
}

async function makeAsyncTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kitsmith-adopt-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeProjectFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function seedBunTsProject(root: string): void {
  writeProjectFile(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "vex",
        private: true,
        bin: { vex: "./src/cli/index.ts" },
        scripts: {
          dev: "bun src/cli/index.ts",
          lint: "biome check src/",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          effect: "^3.19.15",
          "@effect/platform-bun": "^0.87.1",
        },
        devDependencies: {
          "@types/bun": "^1.3.8",
          typescript: "5.9.3",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeProjectFile(
    root,
    "tsconfig.json",
    `${JSON.stringify({ compilerOptions: { types: ["bun"], strict: true }, include: ["src/**/*.ts"] }, null, 2)}\n`,
  );
  writeProjectFile(root, "src/cli/index.ts", "console.log('vex');\n");
}

function makeOptions(destination: string, overrides: Partial<AdoptOptions> = {}): AdoptOptions {
  return {
    destination,
    projectName: toProjectName("vex"),
    packageName: toExistingPackageName("vex"),
    binName: toExistingBinName("vex"),
    frontend: "none",
    ai: true,
    effect: true,
    install: false,
    lintSeverity: "warn",
    apply: false,
    rollback: undefined,
    yes: true,
    ...overrides,
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isUnknownRecord(value)) {
    throw new TypeError("Expected string record");
  }

  const record: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === "string") {
      record[key] = fieldValue;
    }
  }
  return record;
}

function packageJsonShape(value: unknown): {
  readonly scripts: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
} {
  if (
    isUnknownRecord(value) &&
    "scripts" in value &&
    "dependencies" in value &&
    "devDependencies" in value
  ) {
    return {
      scripts: stringRecord(value["scripts"]),
      dependencies: stringRecord(value["dependencies"]),
      devDependencies: stringRecord(value["devDependencies"]),
    };
  }

  throw new TypeError("Expected package JSON shape");
}

describe("deriveAdoptOptions", () => {
  test("derives project metadata from an existing Bun TypeScript package", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const options = await deriveAdoptOptions(dir, { ai: false });

    expect(String(options.projectName)).toBe("vex");
    expect(String(options.packageName)).toBe("vex");
    expect(String(options.binName)).toBe("vex");
    expect(options.frontend).toBe("none");
    expect(options.install).toBe(false);
    expect(options.lintSeverity).toBe("warn");
  });

  test("rejects non-Bun TypeScript packages", async () => {
    const dir = makeTempProject();
    writeProjectFile(
      dir,
      "package.json",
      '{"name":"node-app","scripts":{"test":"node test.js"}}\n',
    );
    writeProjectFile(dir, "tsconfig.json", '{"compilerOptions":{}}\n');

    try {
      await deriveAdoptOptions(dir, {});
      throw new Error("Expected deriveAdoptOptions to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toContain("Adoption currently supports Bun/TypeScript projects only");
    }
  });
});

describe("formatAdoptionPlan", () => {
  test("counts actions by kind without changing plan line order", () => {
    const result = formatAdoptionPlan({
      destination: "/tmp/adopt-target",
      runId: brandValue<string, "BackupRunId">("run-1"),
      actions: [
        {
          kind: "create",
          path: brandValue<string, "SafeRelativePath">("created.ts"),
          reason: "new file",
          content: "",
        },
        {
          kind: "modify",
          path: brandValue<string, "SafeRelativePath">("package.json"),
          reason: "merge scripts",
          content: "",
        },
        {
          kind: "skip",
          path: brandValue<string, "SafeRelativePath">("README.md"),
          reason: "already equivalent",
        },
        {
          kind: "conflict",
          path: brandValue<string, "SafeRelativePath">("src"),
          reason: "parent path is a file",
        },
      ],
    });

    expect(result).toContain("create: 1, modify: 1, skip: 1, conflict: 1");
    expect(result.split("\n").slice(3, 7)).toEqual([
      "create   created.ts - new file",
      "modify   package.json - merge scripts",
      "skip     README.md - already equivalent",
      "conflict src - parent path is a file",
    ]);
  });
});

describe("buildAdoptionPlan", () => {
  test("plans a dry run without touching existing files", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);
    const before = await Bun.file(join(dir, "package.json")).text();

    const plan = await buildAdoptionPlan(makeOptions(dir), {
      now: () => new Date("2026-04-24T00:00:00.000Z"),
      runCommand: async () => {},
      finalizeProject: async () => {},
    });

    expect(String(plan.runId)).toBe("2026-04-24T00-00-00-000Z");
    expect(
      plan.actions.some((action) => action.kind === "modify" && action.path === "package.json"),
    ).toBe(true);
    expect(
      plan.actions.some((action) => action.kind === "create" && action.path === "lefthook.yml"),
    ).toBe(true);
    expect(
      plan.actions.some((action) => action.kind === "conflict" && action.path === "tsconfig.json"),
    ).toBe(true);
    expect(await Bun.file(join(dir, "package.json")).text()).toBe(before);
  });

  test("preserves existing package scripts and dependency versions", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(makeOptions(dir, { ai: false }), {
      now: () => new Date("2026-04-24T00:00:00.000Z"),
      runCommand: async () => {},
      finalizeProject: async () => {},
    });
    const packageAction = plan.actions.find(
      (action) => action.kind === "modify" && action.path === "package.json",
    );

    expect(packageAction?.kind).toBe("modify");
    if (packageAction?.kind !== "modify") {
      throw new Error("Expected package.json modify action");
    }

    const packageJson = packageJsonShape(JSON.parse(packageAction.content) as unknown);
    expect(packageJson.scripts["lint"]).toBe("biome check src/");
    expect(packageJson.scripts["check"]).toBeDefined();
    expect(packageJson.scripts["lint:arch"]).toBeUndefined();
    expect(packageJson.dependencies["effect"]).toBe("^3.19.15");
    expect(packageJson.dependencies["@effect/platform-bun"]).toBe("^0.87.1");
    expect(packageJson.dependencies["@effect/platform"]).toBe("0.96.1");
    expect(packageJson.devDependencies["@types/bun"]).toBe("^1.3.8");
  });

  test("uses preserve-root agent scripts for adopted projects", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(makeOptions(dir, { ai: true }));
    const packageAction = plan.actions.find(
      (action) => action.kind === "modify" && action.path === "package.json",
    );

    expect(packageAction?.kind).toBe("modify");
    if (packageAction?.kind !== "modify") {
      throw new Error("Expected package.json modify action");
    }

    const packageJson = packageJsonShape(JSON.parse(packageAction.content) as unknown);
    expect(packageJson.scripts["agents:sync"]).toBe(
      "bun scripts/agents/sync-agents-md.ts --write --preserve-root",
    );
    expect(packageJson.scripts["agents:check"]).toBeUndefined();
  });

  test("plans generated contract preset outputs for AI and Effect adoption", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(makeOptions(dir, { ai: true, effect: true }));

    expect(
      plan.actions.some(
        (action) => action.kind === "create" && action.path === ".agents/hooks/core/contract.ts",
      ),
    ).toBe(true);
    expect(
      plan.actions.some(
        (action) =>
          action.kind === "create" && action.path === ".claude/rules/native-hook-wrappers.md",
      ),
    ).toBe(true);
    expect(
      plan.actions.some((action) => action.kind === "create" && action.path === ".gitkeep"),
    ).toBe(true);
  });

  test("downgrades adopted OXLint configs to warnings by default", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(
      makeOptions(dir, { frontend: "tanstack", ai: false, lintSeverity: "warn" }),
    );
    const lintActions = plan.actions.filter(
      (action) =>
        action.kind === "create" &&
        (action.path === ".oxlintrc.jsonc" || action.path === "apps/frontend/.oxlintrc.jsonc"),
    );

    expect(lintActions).toHaveLength(2);
    for (const action of lintActions) {
      expect(action.kind).toBe("create");
      if (action.kind !== "create") {
        throw new Error("Expected create action");
      }
      expect(action.content).not.toContain('"error"');
      expect(action.content).toContain('"warn"');
    }
  });

  test("preserves strict adopted OXLint configs when requested", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(makeOptions(dir, { lintSeverity: "error" }));
    const lintAction = plan.actions.find(
      (action) => action.kind === "create" && action.path === ".oxlintrc.jsonc",
    );

    expect(lintAction?.kind).toBe("create");
    if (lintAction?.kind !== "create") {
      throw new Error("Expected .oxlintrc.jsonc create action");
    }
    expect(lintAction.content).toContain('"error"');
  });

  test("plans the full frontend contract when adopting a new frontend", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(makeOptions(dir, { frontend: "tanstack", ai: false }));

    expect(
      plan.actions.some(
        (action) =>
          action.kind === "create" && action.path === "apps/frontend/playwright.config.ts",
      ),
    ).toBe(true);
    expect(
      plan.actions.some(
        (action) =>
          action.kind === "create" && action.path === "apps/frontend/src/testing/setup.ts",
      ),
    ).toBe(true);
    expect(
      plan.actions.some(
        (action) => action.kind === "create" && action.path === "apps/frontend/e2e/home.spec.ts",
      ),
    ).toBe(true);
    expect(plan.actions.some((action) => action.path === "apps/frontend")).toBe(false);
  });

  test("does not inject backend starter source into adopted projects", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);

    const plan = await buildAdoptionPlan(makeOptions(dir, { ai: false, effect: false }));

    expect(
      plan.actions.some(
        (action) =>
          action.kind === "skip" &&
          action.path === "src/index.ts" &&
          action.reason.includes("starter source skipped"),
      ),
    ).toBe(true);
    expect(
      plan.actions.some(
        (action) =>
          action.kind === "skip" &&
          action.path === "src/index.test.ts" &&
          action.reason.includes("starter source skipped"),
      ),
    ).toBe(true);
  });

  test("does not convert an existing frontend in adopt v1", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);
    writeProjectFile(dir, "apps/frontend/package.json", '{"name":"existing-frontend"}\n');

    const plan = await buildAdoptionPlan(makeOptions(dir, { frontend: "tanstack" }));

    expect(
      plan.actions.some(
        (action) =>
          action.kind === "conflict" &&
          action.path === "apps/frontend" &&
          action.reason.includes("does not convert frontends"),
      ),
    ).toBe(true);
  });

  test("reports parent path file conflicts before apply", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);
    writeProjectFile(dir, ".codex", "existing .codex file marker\n");

    const plan = await buildAdoptionPlan(makeOptions(dir, { ai: true }));

    expect(
      plan.actions.some(
        (action) =>
          action.kind === "skip" &&
          action.path === ".codex/config.toml" &&
          action.reason.includes("Codex config preserved"),
      ),
    ).toBe(true);
  });

  test("keeps non-Codex parent path conflicts explicit before apply", async () => {
    const dir = makeTempProject();
    seedBunTsProject(dir);
    writeProjectFile(dir, ".claude", "existing .claude file marker\n");

    const plan = await buildAdoptionPlan(makeOptions(dir, { ai: true }));

    expect(
      plan.actions.some(
        (action) =>
          action.kind === "conflict" &&
          action.path === ".claude/settings.json" &&
          action.reason.includes("Cannot create below existing non-directory path"),
      ),
    ).toBe(true);
  });

  test.if(canCreateSymlinks)(
    "preserves Vex-like root AI files and adds a Kitsmith rule",
    async () => {
      const dir = makeTempProject();
      seedBunTsProject(dir);
      writeProjectFile(dir, "AI.md", "Existing Vex guidance\n");
      symlinkSync("AI.md", join(dir, "CLAUDE.md"), "file");
      symlinkSync("AI.md", join(dir, "AGENTS.md"), "file");
      writeProjectFile(dir, ".codex", "existing .codex file marker\n");
      mkdirSync(join(dir, ".claude/worktrees"), { recursive: true });

      const plan = await buildAdoptionPlan(makeOptions(dir, { ai: true }));

      expect(
        plan.actions.some(
          (action) =>
            action.kind === "skip" &&
            action.path === "CLAUDE.md" &&
            action.reason.includes("preserved"),
        ),
      ).toBe(true);
      expect(
        plan.actions.some(
          (action) => action.kind === "create" && action.path === ".claude/rules/source-code.md",
        ),
      ).toBe(true);
      expect(
        plan.actions.some((action) => action.path === ".claude/rules/project-conventions.md"),
      ).toBe(false);
    },
  );

  test("rejects self-adoption of the kitsmith parent repo", async () => {
    const dir = makeTempProject();
    writeProjectFile(
      dir,
      "package.json",
      `${JSON.stringify(
        {
          name: "kitsmith",
          private: true,
          scripts: { dev: "bun src/index.ts" },
          devDependencies: { "@types/bun": "^1.3.8", typescript: "6.0.3" },
        },
        null,
        2,
      )}\n`,
    );
    writeProjectFile(dir, "tsconfig.json", "{\n}\n");
    writeProjectFile(dir, "template-sources/manifest.json", "{}\n");
    writeProjectFile(dir, "src/core/generated-project-contract.ts", "export {};\n");

    try {
      await buildAdoptionPlan(
        makeOptions(dir, {
          projectName: toProjectName("kitsmith"),
          packageName: toExistingPackageName("kitsmith"),
          binName: toExistingBinName("kitsmith"),
        }),
      );
      throw new Error("Expected buildAdoptionPlan to reject kitsmith self-adoption");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toContain("parent-tooling:sync");
    }
  });
});

describe("applyAdoptionPlan and rollbackAdoption", () => {
  test("backs up modified files and removes created files on rollback", async () => {
    const dir = await makeAsyncTempProject();
    seedBunTsProject(dir);
    const options = makeOptions(dir, { ai: false });
    const plan = await buildAdoptionPlan(options, {
      now: () => new Date("2026-04-24T00:00:00.000Z"),
      runCommand: async () => {},
      finalizeProject: async () => {},
    });

    const beforePackage = await Bun.file(join(dir, "package.json")).text();
    await applyAdoptionPlan(plan, options, {
      now: () => new Date("2026-04-24T00:00:00.000Z"),
      runCommand: async () => {},
      finalizeProject: async () => {},
    });

    expect(await Bun.file(join(dir, "lefthook.yml")).exists()).toBe(true);
    expect(
      await Bun.file(
        join(dir, ".kitsmith/backups/2026-04-24T00-00-00-000Z/manifest.json"),
      ).exists(),
    ).toBe(true);

    await rollbackAdoption(dir, "2026-04-24T00-00-00-000Z");

    expect(await Bun.file(join(dir, "package.json")).text()).toBe(beforePackage);
    expect(await Bun.file(join(dir, "lefthook.yml")).exists()).toBe(false);
  });

  test("runs preserve-root agent sync while existing guidance is preserved", async () => {
    const dir = await makeAsyncTempProject();
    seedBunTsProject(dir);
    writeProjectFile(dir, "CLAUDE.md", "Existing guidance\n");
    const options = makeOptions(dir, { ai: true });
    const plan = await buildAdoptionPlan(options);
    const calls: string[][] = [];

    await applyAdoptionPlan(plan, options, {
      now: () => new Date("2026-04-24T00:00:00.000Z"),
      runCommand: async (command) => {
        calls.push(command);
      },
      finalizeProject: async () => {},
    });

    expect(calls).toEqual([
      ["bun", "scripts/agents/sync-agents-md.ts", "--write", "--preserve-root"],
    ]);
    expect(await Bun.file(join(dir, "CLAUDE.md")).text()).toBe("Existing guidance\n");
  });

  test.if(canCreateSymlinks)("keeps root AI symlinks intact during apply", async () => {
    const dir = await makeAsyncTempProject();
    seedBunTsProject(dir);
    writeProjectFile(dir, "AI.md", "Existing Vex guidance\n");
    symlinkSync("AI.md", join(dir, "CLAUDE.md"), "file");
    symlinkSync("AI.md", join(dir, "AGENTS.md"), "file");
    const options = makeOptions(dir, { ai: true });
    const plan = await buildAdoptionPlan(options);

    await applyAdoptionPlan(plan, options, {
      now: () => new Date("2026-04-24T00:00:00.000Z"),
      runCommand: async () => {},
      finalizeProject: async () => {},
    });

    expect(lstatSync(join(dir, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(await Bun.file(join(dir, "AI.md")).text()).toBe("Existing Vex guidance\n");
  });
});
