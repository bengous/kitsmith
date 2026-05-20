import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkGeneratedDependencies,
  DEFAULT_PKL_COMMAND,
  evaluateGeneratedDependenciesPkl,
  parseGeneratedDependencyBaseline,
  parseGeneratedDependenciesMode,
  renderGeneratedDependenciesArtifact,
  syncGeneratedDependencies,
  validateParentDependencyDrift,
} from "./generated-dependencies.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kitsmith-generated-dependencies-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(root: string, path: string, content: string): Promise<void> {
  await Bun.write(join(root, path), content);
}

async function expectRejectsWithMessage(
  action: () => Promise<void> | void,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    expect(error.message).toContain(expectedMessage);
    return;
  }
  throw new Error("Expected action to reject");
}

function onePackageBaseline(version = "1.0.0"): unknown {
  return {
    baseline: {
      packages: {
        "shared-tool": {
          version,
          sharedWithParent: true,
          emissions: [{ target: "root.devDependencies" }],
        },
      },
      compatibilityGroups: {},
    },
  };
}

async function writeFakePkl(root: string, rawOutput: unknown): Promise<readonly string[]> {
  const scriptPath = join(root, "fake-pkl.ts");
  await Bun.write(
    scriptPath,
    `#!/usr/bin/env bun\nprocess.stdout.write(${JSON.stringify(JSON.stringify(rawOutput))});\n`,
  );
  chmodSync(scriptPath, 0o755);
  return ["bun", scriptPath];
}

describe("generated dependency baseline validation", () => {
  test("accepts a package-owned baseline with target-specific Dependency Emissions", () => {
    const baseline = parseGeneratedDependencyBaseline({
      baseline: {
        packages: {
          "shared-tool": {
            version: "1.0.0",
            sharedWithParent: true,
            emissions: [{ target: "root.devDependencies" }],
          },
          react: {
            version: "19.2.6",
            sharedWithParent: false,
            compatibilityGroup: "react-types",
            emissions: [
              {
                target: "frontend.dependencies",
                conditions: { frontend: "tanstack" },
              },
            ],
          },
          "react-dom": {
            version: "19.2.6",
            sharedWithParent: false,
            compatibilityGroup: "react-types",
            emissions: [
              {
                target: "frontend.dependencies",
                conditions: { frontend: "tanstack" },
              },
            ],
          },
        },
        compatibilityGroups: {
          "react-types": {
            policy: "same-major",
            packages: ["react", "react-dom"],
          },
        },
      },
    });

    expect(baseline.packages.map((dependency) => dependency.packageName)).toEqual([
      "react",
      "react-dom",
      "shared-tool",
    ]);
    expect(renderGeneratedDependenciesArtifact(baseline)).toContain(
      "GENERATED_DEPENDENCY_EMISSIONS_BY_TARGET",
    );
  });

  test("rejects invalid targets, conditions, emissions, groups, and shared-parent policy", () => {
    let message = "";
    try {
      parseGeneratedDependencyBaseline({
        baseline: {
          packages: {
            bad: {
              version: "1.0.0",
              sharedWithParent: "yes",
              emissions: [
                {
                  target: "frontend.optionalDependencies",
                },
              ],
            },
            badCondition: {
              version: "1.0.0",
              sharedWithParent: false,
              emissions: [
                {
                  target: "root.devDependencies",
                  conditions: { runtime: true },
                },
              ],
            },
            empty: {
              version: "1.0.0",
              sharedWithParent: false,
              emissions: [],
            },
            frontend: {
              version: "1.0.0",
              sharedWithParent: false,
              emissions: [{ target: "frontend.devDependencies" }],
            },
            effect: {
              version: "1.0.0",
              sharedWithParent: false,
              emissions: [{ target: "root.dependencies" }],
            },
            grouped: {
              version: "1.0.0",
              sharedWithParent: false,
              compatibilityGroup: "missing-group",
              emissions: [{ target: "root.devDependencies" }],
            },
          },
          compatibilityGroups: {
            badGroup: {
              policy: "latest-compatible",
              packages: ["grouped", "absent"],
            },
          },
        },
      });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      message = error.message;
    }

    for (const expected of [
      "packages.bad.sharedWithParent must be a boolean",
      'target "frontend.optionalDependencies" is not a supported dependency target',
      "packages.badCondition.emissions[0].conditions.runtime: unknown condition",
      "packages.empty.emissions must contain at least one Dependency Emission",
      "frontend dependency targets require conditions.frontend",
      "Effect dependencies require conditions.effect = true",
      'compatibilityGroup references unknown compatibility group "missing-group"',
      'policy "latest-compatible" is not a supported compatibility group policy',
    ]) {
      expect(message).toContain(expected);
    }
  });

  test("requires Effect conditions for scoped Effect ecosystem packages", () => {
    expect(() =>
      parseGeneratedDependencyBaseline({
        baseline: {
          packages: {
            "@effect/cli": {
              version: "1.0.0",
              sharedWithParent: false,
              emissions: [{ target: "root.dependencies" }],
            },
          },
          compatibilityGroups: {},
        },
      }),
    ).toThrow("Effect dependencies require conditions.effect = true");
  });

  test("enforces machine-checkable compatibility group policy", () => {
    expect(() =>
      parseGeneratedDependencyBaseline({
        baseline: {
          packages: {
            react: {
              version: "19.2.6",
              sharedWithParent: false,
              compatibilityGroup: "react-types",
              emissions: [
                {
                  target: "frontend.dependencies",
                  conditions: { frontend: "tanstack" },
                },
              ],
            },
            "react-dom": {
              version: "20.0.0",
              sharedWithParent: false,
              compatibilityGroup: "react-types",
              emissions: [
                {
                  target: "frontend.dependencies",
                  conditions: { frontend: "tanstack" },
                },
              ],
            },
          },
          compatibilityGroups: {
            "react-types": {
              policy: "same-major",
              packages: ["react", "react-dom"],
            },
          },
        },
      }),
    ).toThrow("same-major packages do not share one first dot-separated version component");
  });

  test("enforces bidirectional reference checks between packages and compatibility groups", () => {
    expect(() =>
      parseGeneratedDependencyBaseline({
        baseline: {
          packages: {
            react: {
              version: "19.2.6",
              sharedWithParent: false,
              compatibilityGroup: "react-types",
              emissions: [
                {
                  target: "frontend.dependencies",
                  conditions: { frontend: "tanstack" },
                },
              ],
            },
            "react-dom": {
              version: "19.2.6",
              sharedWithParent: false,
              compatibilityGroup: "react-types",
              emissions: [
                {
                  target: "frontend.dependencies",
                  conditions: { frontend: "tanstack" },
                },
              ],
            },
          },
          compatibilityGroups: {
            "react-types": {
              policy: "same-major",
              packages: ["react-dom"],
            },
          },
        },
      }),
    ).toThrow(
      'packages.react declares compatibilityGroup "react-types", but is not listed in compatibilityGroups.react-types.packages',
    );

    expect(() =>
      parseGeneratedDependencyBaseline({
        baseline: {
          packages: {
            react: {
              version: "19.2.6",
              sharedWithParent: false,
              emissions: [
                {
                  target: "frontend.dependencies",
                  conditions: { frontend: "tanstack" },
                },
              ],
            },
          },
          compatibilityGroups: {
            "react-types": {
              policy: "same-major",
              packages: ["react"],
            },
          },
        },
      }),
    ).toThrow(
      'compatibilityGroups.react-types.packages lists "react", but packages.react.compatibilityGroup is "undefined"',
    );
  });
});

describe("generated dependency drift checks", () => {
  test("default Pkl command suppresses mise prepare output", () => {
    expect(DEFAULT_PKL_COMMAND).toEqual(["mise", "exec", "--quiet", "--no-prepare", "--", "pkl"]);
  });

  test("mode parsing rejects ambiguous or unknown CLI flags", () => {
    expect(parseGeneratedDependenciesMode(["--write"])).toBe("write");
    expect(parseGeneratedDependenciesMode(["--check"])).toBe("check");
    expect(() => parseGeneratedDependenciesMode([])).toThrow("Pass exactly one mode");
    expect(() => parseGeneratedDependenciesMode(["--write", "--check"])).toThrow(
      "Pass exactly one mode",
    );
    expect(() => parseGeneratedDependenciesMode(["--wirte"])).toThrow(
      "Unknown generated dependency option",
    );
  });

  test("requires shared dependencies to appear in exactly one parent package section", () => {
    const baseline = parseGeneratedDependencyBaseline(onePackageBaseline("1.0.0"));

    expect(() =>
      validateParentDependencyDrift(baseline, {
        dependencies: {},
        devDependencies: {},
      }),
    ).toThrow("shared dependency 1.0.0 is missing from parent package.json");

    expect(() =>
      validateParentDependencyDrift(baseline, {
        dependencies: { "shared-tool": "1.0.0" },
        devDependencies: { "shared-tool": "1.0.0" },
      }),
    ).toThrow("appears in both parent dependencies and devDependencies");

    expect(() =>
      validateParentDependencyDrift(baseline, {
        dependencies: {},
        devDependencies: { "shared-tool": "2.0.0" },
      }),
    ).toThrow("baseline version 1.0.0 differs from parent package.json version 2.0.0");
  });

  test("check mode is read-only and fails on stale artifact drift", async () => {
    const dir = makeTempDir();
    await writeFile(
      dir,
      "package.json",
      JSON.stringify({ devDependencies: { "shared-tool": "1.0.0" } }),
    );
    await writeFile(dir, "artifact.ts", "stale\n");
    const pklCommand = await writeFakePkl(dir, onePackageBaseline("1.0.0"));

    await expectRejectsWithMessage(
      async () => checkGeneratedDependencies({ cwd: dir, artifactPath: "artifact.ts", pklCommand }),
      "stale Generated Dependency Artifact",
    );

    expect(await Bun.file(join(dir, "artifact.ts")).text()).toBe("stale\n");
  });

  test("sync writes the artifact from Pkl output and check accepts the fresh artifact", async () => {
    const dir = makeTempDir();
    await writeFile(
      dir,
      "package.json",
      JSON.stringify({ devDependencies: { "shared-tool": "1.0.0" } }),
    );
    const pklCommand = await writeFakePkl(dir, onePackageBaseline("1.0.0"));

    await syncGeneratedDependencies({ cwd: dir, artifactPath: "artifact.ts", pklCommand });
    await checkGeneratedDependencies({ cwd: dir, artifactPath: "artifact.ts", pklCommand });

    expect(await Bun.file(join(dir, "artifact.ts")).text()).toContain(
      '"shared-tool": {\n    sharedWithParent: true,\n    version: "1.0.0",',
    );
  });

  test("missing Pkl fails with an actionable tool-manager repair message", async () => {
    await expectRejectsWithMessage(async () => {
      await evaluateGeneratedDependenciesPkl({ command: ["missing-pkl-for-kitsmith-test"] });
    }, "mise install pkl");
  });
});
