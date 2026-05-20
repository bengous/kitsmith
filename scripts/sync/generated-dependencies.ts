#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export const GENERATED_DEPENDENCIES_SCHEMA_PATH =
  "config/generated-dependencies/GeneratedDependencies.pkl";
export const GENERATED_DEPENDENCIES_BASELINE_PATH = "config/generated-dependencies/baseline.pkl";
export const GENERATED_DEPENDENCIES_ARTIFACT_PATH = "src/core/generated-dependencies.generated.ts";

export const DEPENDENCY_TARGETS = [
  "root.dependencies",
  "root.devDependencies",
  "frontend.dependencies",
  "frontend.devDependencies",
] as const;

export const CONDITION_KEYS = ["backend", "frontend", "ai", "effect"] as const;
export const FRONTEND_VALUES = ["tanstack"] as const;
export const COMPATIBILITY_GROUP_POLICIES = ["same-major", "review-together"] as const;

export type DependencyTarget = (typeof DEPENDENCY_TARGETS)[number];
export type ConditionKey = (typeof CONDITION_KEYS)[number];
export type FrontendValue = (typeof FRONTEND_VALUES)[number];
export type CompatibilityGroupPolicy = (typeof COMPATIBILITY_GROUP_POLICIES)[number];

export type DependencyConditions = {
  readonly backend?: boolean;
  readonly frontend?: FrontendValue;
  readonly ai?: boolean;
  readonly effect?: boolean;
};

export type DependencyEmission = {
  readonly target: DependencyTarget;
  readonly conditions?: DependencyConditions;
};

export type GeneratedDependency = {
  readonly packageName: string;
  readonly version: string;
  readonly sharedWithParent: boolean;
  readonly compatibilityGroup?: string;
  readonly emissions: readonly DependencyEmission[];
};

export type CompatibilityGroup = {
  readonly name: string;
  readonly policy: CompatibilityGroupPolicy;
  readonly packages: readonly string[];
};

export type GeneratedDependencyBaseline = {
  readonly packages: readonly GeneratedDependency[];
  readonly compatibilityGroups: readonly CompatibilityGroup[];
};

type ParentPackageSections = {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};

type RenderedDependencyEmission = {
  readonly packageName: string;
  readonly version: string;
  readonly conditions?: DependencyConditions;
};

type PklCommandInput = {
  readonly cwd?: string;
  readonly command?: readonly string[];
  readonly baselinePath?: string;
};

type CheckInput = {
  readonly cwd?: string;
  readonly artifactPath?: string;
  readonly pklCommand?: readonly string[];
  readonly baselinePath?: string;
};

type SyncInput = CheckInput;

class GeneratedDependenciesValidationError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(errors.join("\n"));
    this.name = "GeneratedDependenciesValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, label: string, errors: string[]): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  errors.push(`${label} must be a non-empty string`);
  return null;
}

function readBoolean(value: unknown, label: string, errors: string[]): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  errors.push(`${label} must be a boolean`);
  return null;
}

function isDependencyTarget(value: string): value is DependencyTarget {
  return DEPENDENCY_TARGETS.some((target) => target === value);
}

function isConditionKey(value: string): value is ConditionKey {
  return CONDITION_KEYS.some((key) => key === value);
}

function isFrontendValue(value: string): value is FrontendValue {
  return FRONTEND_VALUES.some((frontend) => frontend === value);
}

function isCompatibilityGroupPolicy(value: string): value is CompatibilityGroupPolicy {
  return COMPATIBILITY_GROUP_POLICIES.some((policy) => policy === value);
}

function sortByName<T extends { readonly name: string }>(items: readonly T[]): T[] {
  return [...items].toSorted((left, right) => left.name.localeCompare(right.name));
}

function sortDependencies(items: readonly GeneratedDependency[]): GeneratedDependency[] {
  return [...items].toSorted((left, right) => left.packageName.localeCompare(right.packageName));
}

function stableStringify(value: unknown, indent = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every((item) => typeof item === "string")) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (inline.length <= 100) {
        return inline;
      }
    }
    const nextIndent = indent + 2;
    const items = value.map(
      (item) => `${" ".repeat(nextIndent)}${stableStringify(item, nextIndent)},`,
    );
    return `[\n${items.join("\n")}\n${" ".repeat(indent)}]`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    if (entries.length === 0) {
      return "{}";
    }
    const nextIndent = indent + 2;
    const items = entries
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entryValue]) =>
          `${" ".repeat(nextIndent)}${formatPropertyKey(key)}: ${stableStringify(
            entryValue,
            nextIndent,
          )},`,
      );
    return `{\n${items.join("\n")}\n${" ".repeat(indent)}}`;
  }

  return JSON.stringify(value);
}

function formatPropertyKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function parseConditions(
  rawConditions: unknown,
  label: string,
  errors: string[],
): DependencyConditions | undefined {
  if (rawConditions === null || rawConditions === undefined) {
    return undefined;
  }

  if (!isRecord(rawConditions)) {
    errors.push(`${label} must be an object when present`);
    return undefined;
  }

  const conditions: {
    backend?: boolean;
    frontend?: FrontendValue;
    ai?: boolean;
    effect?: boolean;
  } = {};
  for (const [key, value] of Object.entries(rawConditions)) {
    if (!isConditionKey(key)) {
      errors.push(`${label}.${key}: unknown condition`);
      continue;
    }

    if (key === "frontend") {
      if (typeof value !== "string" || !isFrontendValue(value)) {
        errors.push(`${label}.frontend must be one of: ${FRONTEND_VALUES.join(", ")}`);
        continue;
      }
      conditions.frontend = value;
      continue;
    }

    if (typeof value !== "boolean") {
      errors.push(`${label}.${key} must be a boolean`);
      continue;
    }
    conditions[key] = value;
  }

  return Object.keys(conditions).length === 0 ? undefined : conditions;
}

function parseEmission(
  rawEmission: unknown,
  label: string,
  packageName: string,
  errors: string[],
): DependencyEmission | null {
  if (!isRecord(rawEmission)) {
    errors.push(`${label} must be an object`);
    return null;
  }

  const target = readString(rawEmission["target"], `${label}.target`, errors);
  if (target === null) {
    return null;
  }
  if (!isDependencyTarget(target)) {
    errors.push(`${label}.target "${target}" is not a supported dependency target`);
    return null;
  }

  const conditions = parseConditions(rawEmission["conditions"], `${label}.conditions`, errors);
  if (target.startsWith("frontend.") && conditions?.frontend === undefined) {
    errors.push(`${label}: frontend dependency targets require conditions.frontend`);
  }

  if (isEffectPackage(packageName) && conditions?.effect !== true) {
    errors.push(`${label}: Effect dependencies require conditions.effect = true`);
  }

  return conditions === undefined ? { target } : { target, conditions };
}

function isEffectPackage(packageName: string): boolean {
  return packageName === "effect" || packageName.startsWith("@effect/");
}

function parseGeneratedDependency(
  packageName: string,
  rawDependency: unknown,
  errors: string[],
): GeneratedDependency | null {
  const label = `packages.${packageName}`;
  if (!isRecord(rawDependency)) {
    errors.push(`${label} must be an object`);
    return null;
  }

  const version = readString(rawDependency["version"], `${label}.version`, errors);
  const sharedWithParent = readBoolean(
    rawDependency["sharedWithParent"],
    `${label}.sharedWithParent`,
    errors,
  );
  const rawCompatibilityGroup = rawDependency["compatibilityGroup"];
  const compatibilityGroup =
    rawCompatibilityGroup === null || rawCompatibilityGroup === undefined
      ? undefined
      : readString(rawCompatibilityGroup, `${label}.compatibilityGroup`, errors);

  if (!Array.isArray(rawDependency["emissions"]) || rawDependency["emissions"].length === 0) {
    errors.push(`${label}.emissions must contain at least one Dependency Emission`);
    return null;
  }

  const emissions = rawDependency["emissions"]
    .map((rawEmission, index) =>
      parseEmission(rawEmission, `${label}.emissions[${index}]`, packageName, errors),
    )
    .filter((emission): emission is DependencyEmission => emission !== null);

  if (version === null || sharedWithParent === null || emissions.length === 0) {
    return null;
  }

  return {
    packageName,
    version,
    sharedWithParent,
    ...(compatibilityGroup === undefined || compatibilityGroup === null
      ? {}
      : { compatibilityGroup }),
    emissions: emissions.toSorted((left, right) => left.target.localeCompare(right.target)),
  };
}

function parseCompatibilityGroup(
  name: string,
  rawGroup: unknown,
  errors: string[],
): CompatibilityGroup | null {
  const label = `compatibilityGroups.${name}`;
  if (!isRecord(rawGroup)) {
    errors.push(`${label} must be an object`);
    return null;
  }

  const policy = readString(rawGroup["policy"], `${label}.policy`, errors);
  if (policy !== null && !isCompatibilityGroupPolicy(policy)) {
    errors.push(`${label}.policy "${policy}" is not a supported compatibility group policy`);
  }

  if (!Array.isArray(rawGroup["packages"]) || rawGroup["packages"].length === 0) {
    errors.push(`${label}.packages must contain at least one package`);
    return null;
  }

  const packages = rawGroup["packages"]
    .map((rawPackage, index) => readString(rawPackage, `${label}.packages[${index}]`, errors))
    .filter((packageName): packageName is string => packageName !== null)
    .toSorted((left, right) => left.localeCompare(right));

  if (policy === null || !isCompatibilityGroupPolicy(policy) || packages.length === 0) {
    return null;
  }

  return { name, policy, packages };
}

function validateCompatibilityGroups(
  baseline: GeneratedDependencyBaseline,
  errors: string[],
): void {
  const packages = new Map(
    baseline.packages.map((dependency) => [dependency.packageName, dependency] as const),
  );
  const groups = new Map(baseline.compatibilityGroups.map((group) => [group.name, group] as const));

  for (const dependency of baseline.packages) {
    if (dependency.compatibilityGroup !== undefined) {
      const group = groups.get(dependency.compatibilityGroup);
      if (group === undefined) {
        errors.push(
          `packages.${dependency.packageName}.compatibilityGroup references unknown compatibility group "${dependency.compatibilityGroup}"`,
        );
      } else if (!group.packages.includes(dependency.packageName)) {
        errors.push(
          `packages.${dependency.packageName} declares compatibilityGroup "${dependency.compatibilityGroup}", but is not listed in compatibilityGroups.${dependency.compatibilityGroup}.packages`,
        );
      }
    }
  }

  for (const group of baseline.compatibilityGroups) {
    for (const packageName of group.packages) {
      const dependency = packages.get(packageName);
      if (dependency === undefined) {
        errors.push(
          `compatibilityGroups.${group.name}: package "${packageName}" is not in the Generated Dependency Baseline`,
        );
        continue;
      }

      if (dependency.compatibilityGroup !== group.name) {
        errors.push(
          `compatibilityGroups.${group.name}.packages lists "${packageName}", but packages.${packageName}.compatibilityGroup is "${dependency.compatibilityGroup ?? "undefined"}"`,
        );
      }
    }

    if (group.policy === "same-major") {
      const majors = new Map<string, string[]>();
      for (const packageName of group.packages) {
        const version = packages.get(packageName)?.version;
        if (version === undefined) {
          continue;
        }
        const major = version.split(".")[0] ?? "";
        const existing = majors.get(major) ?? [];
        existing.push(packageName);
        majors.set(major, existing);
      }
      if (majors.size > 1) {
        errors.push(
          `compatibilityGroups.${group.name}: same-major packages do not share one first dot-separated version component`,
        );
      }
    }
  }
}

export function parseGeneratedDependencyBaseline(rawOutput: unknown): GeneratedDependencyBaseline {
  const errors: string[] = [];
  if (!isRecord(rawOutput)) {
    throw new GeneratedDependenciesValidationError([
      "Pkl output must be a JSON object containing baseline",
    ]);
  }

  const rawBaseline = rawOutput["baseline"];
  if (!isRecord(rawBaseline)) {
    throw new GeneratedDependenciesValidationError(["Pkl output must contain object baseline"]);
  }

  const rawPackages = rawBaseline["packages"];
  if (!isRecord(rawPackages)) {
    errors.push("baseline.packages must be a mapping");
  }

  const rawCompatibilityGroups = rawBaseline["compatibilityGroups"];
  if (rawCompatibilityGroups !== undefined && !isRecord(rawCompatibilityGroups)) {
    errors.push("baseline.compatibilityGroups must be a mapping when present");
  }

  const packages = isRecord(rawPackages)
    ? Object.entries(rawPackages)
        .map(([packageName, dependency]) =>
          parseGeneratedDependency(packageName, dependency, errors),
        )
        .filter((dependency): dependency is GeneratedDependency => dependency !== null)
    : [];

  const compatibilityGroups = isRecord(rawCompatibilityGroups)
    ? Object.entries(rawCompatibilityGroups)
        .map(([name, group]) => parseCompatibilityGroup(name, group, errors))
        .filter((group): group is CompatibilityGroup => group !== null)
    : [];

  const baseline = {
    packages: sortDependencies(packages),
    compatibilityGroups: sortByName(compatibilityGroups),
  } satisfies GeneratedDependencyBaseline;

  validateCompatibilityGroups(baseline, errors);

  if (errors.length > 0) {
    throw new GeneratedDependenciesValidationError(errors);
  }

  return baseline;
}

function renderHeader(): string {
  return [
    "// This file is generated by `bun run generated-dependencies:sync`.",
    "// Edit config/generated-dependencies/baseline.pkl instead.",
    "// Domain language: docs/generated-dependencies/UBIQUITOUS_LANGUAGE.md.",
    "",
  ].join("\n");
}

function renderTargetedEmissions(
  baseline: GeneratedDependencyBaseline,
): Record<DependencyTarget, RenderedDependencyEmission[]> {
  const emissionsByTarget: Record<DependencyTarget, RenderedDependencyEmission[]> = {
    "root.dependencies": [],
    "root.devDependencies": [],
    "frontend.dependencies": [],
    "frontend.devDependencies": [],
  };

  for (const dependency of baseline.packages) {
    for (const emission of dependency.emissions) {
      emissionsByTarget[emission.target].push({
        packageName: dependency.packageName,
        version: dependency.version,
        ...(emission.conditions === undefined ? {} : { conditions: emission.conditions }),
      });
    }
  }

  for (const target of DEPENDENCY_TARGETS) {
    emissionsByTarget[target].sort((left, right) =>
      left.packageName.localeCompare(right.packageName),
    );
  }

  return emissionsByTarget;
}

function renderStringUnion(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(" | ");
}

function renderDependencyTargetType(): string {
  return DEPENDENCY_TARGETS.map((target) => `  | ${JSON.stringify(target)}`).join("\n");
}

export function renderGeneratedDependenciesArtifact(baseline: GeneratedDependencyBaseline): string {
  const packages = Object.fromEntries(
    baseline.packages.map((dependency) => [
      dependency.packageName,
      {
        version: dependency.version,
        sharedWithParent: dependency.sharedWithParent,
        ...(dependency.compatibilityGroup === undefined
          ? {}
          : { compatibilityGroup: dependency.compatibilityGroup }),
      },
    ]),
  );
  const compatibilityGroups = Object.fromEntries(
    baseline.compatibilityGroups.map((group) => [
      group.name,
      {
        policy: group.policy,
        packages: group.packages,
      },
    ]),
  );

  return `${renderHeader()}export type GeneratedPackageName = string;
export type GeneratedPackageVersion = string;
export type DependencyTarget =
${renderDependencyTargetType()};

export type GeneratedDependencyConditions = {
  readonly backend?: boolean;
  readonly frontend?: ${renderStringUnion(FRONTEND_VALUES)};
  readonly ai?: boolean;
  readonly effect?: boolean;
};

export type GeneratedDependencyPackage = {
  readonly version: GeneratedPackageVersion;
  readonly sharedWithParent: boolean;
  readonly compatibilityGroup?: string;
};

export type GeneratedDependencyEmission = {
  readonly packageName: GeneratedPackageName;
  readonly version: GeneratedPackageVersion;
  readonly conditions?: GeneratedDependencyConditions;
};

export type CompatibilityGroupPolicy = ${renderStringUnion(COMPATIBILITY_GROUP_POLICIES)};

export type GeneratedDependencyCompatibilityGroup = {
  readonly policy: CompatibilityGroupPolicy;
  readonly packages: readonly GeneratedPackageName[];
};

export const GENERATED_DEPENDENCY_PACKAGES = ${stableStringify(packages)} as const satisfies Readonly<Record<GeneratedPackageName, GeneratedDependencyPackage>>;

export const GENERATED_DEPENDENCY_EMISSIONS_BY_TARGET = ${stableStringify(
    renderTargetedEmissions(baseline),
  )} as const satisfies Readonly<Record<DependencyTarget, readonly GeneratedDependencyEmission[]>>;

export const GENERATED_DEPENDENCY_COMPATIBILITY_GROUPS = ${stableStringify(
    compatibilityGroups,
  )} as const satisfies Readonly<Record<string, GeneratedDependencyCompatibilityGroup>>;
`;
}

function packageSectionsFromJson(rawPackage: unknown): ParentPackageSections {
  if (!isRecord(rawPackage)) {
    throw new Error("package.json must be a JSON object");
  }

  const dependencies = rawPackage["dependencies"];
  const devDependencies = rawPackage["devDependencies"];
  return {
    dependencies: isRecord(dependencies) ? stringifySection(dependencies, "dependencies") : {},
    devDependencies: isRecord(devDependencies)
      ? stringifySection(devDependencies, "devDependencies")
      : {},
  };
}

function stringifySection(
  section: Record<string, unknown>,
  sectionName: string,
): Readonly<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const [packageName, version] of Object.entries(section)) {
    if (typeof version !== "string") {
      throw new TypeError(`package.json ${sectionName}.${packageName} must be a string`);
    }
    entries[packageName] = version;
  }
  return entries;
}

export function validateParentDependencyDrift(
  baseline: GeneratedDependencyBaseline,
  parentPackage: ParentPackageSections,
): void {
  const errors: string[] = [];
  for (const dependency of baseline.packages) {
    if (!dependency.sharedWithParent) {
      continue;
    }

    const dependencyVersion = parentPackage.dependencies[dependency.packageName];
    const devDependencyVersion = parentPackage.devDependencies[dependency.packageName];
    const occurrenceCount =
      (dependencyVersion === undefined ? 0 : 1) + (devDependencyVersion === undefined ? 0 : 1);

    if (occurrenceCount === 0) {
      errors.push(
        `${dependency.packageName}: shared dependency ${dependency.version} is missing from parent package.json; edit package.json or ${GENERATED_DEPENDENCIES_BASELINE_PATH}, then run \`bun run generated-dependencies:sync\``,
      );
      continue;
    }

    if (occurrenceCount > 1) {
      errors.push(
        `${dependency.packageName}: shared dependency appears in both parent dependencies and devDependencies; keep exactly one parent declaration`,
      );
      continue;
    }

    const parentVersion = dependencyVersion ?? devDependencyVersion;
    if (parentVersion !== dependency.version) {
      errors.push(
        `${dependency.packageName}: baseline version ${dependency.version} differs from parent package.json version ${parentVersion}; edit the intended source, then run \`bun run generated-dependencies:sync\``,
      );
    }
  }

  if (errors.length > 0) {
    throw new GeneratedDependenciesValidationError(errors);
  }
}

export async function evaluateGeneratedDependenciesPkl(
  input: PklCommandInput = {},
): Promise<string> {
  const cwd = input.cwd ?? process.cwd();
  const command = input.command ?? ["mise", "exec", "--", "pkl"];
  const executable = command[0];
  if (executable === undefined) {
    throw formatPklInvocationError(new Error("missing Pkl command"));
  }
  const baselinePath = input.baselinePath ?? GENERATED_DEPENDENCIES_BASELINE_PATH;
  const args = [...command.slice(1), "eval", "--format", "json", baselinePath];

  let proc: Bun.Subprocess<"inherit", "pipe", "pipe">;
  try {
    proc = Bun.spawn([executable, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
    });
  } catch (error) {
    throw formatPklInvocationError(error);
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw formatPklInvocationError(new Error(stderr.trim() || stdout.trim() || "unknown error"));
  }

  return stdout;
}

function formatPklInvocationError(error: unknown): Error {
  const detail = error instanceof Error && error.message.length > 0 ? `\n${error.message}` : "";
  return new Error(
    `Unable to evaluate the Generated Dependency Baseline with Pkl. Ensure Pkl is installed through the root tool manager with \`mise install pkl\`, then rerun \`bun run generated-dependencies:check\`.${detail}`,
  );
}

async function readBaseline(input: PklCommandInput = {}): Promise<GeneratedDependencyBaseline> {
  const rawJson = await evaluateGeneratedDependenciesPkl(input);
  return parseGeneratedDependencyBaseline(JSON.parse(rawJson));
}

function pklInputForCheck(cwd: string, input: CheckInput): PklCommandInput {
  return {
    cwd,
    ...(input.pklCommand === undefined ? {} : { command: input.pklCommand }),
    ...(input.baselinePath === undefined ? {} : { baselinePath: input.baselinePath }),
  };
}

async function readParentPackage(cwd: string): Promise<ParentPackageSections> {
  return packageSectionsFromJson(JSON.parse(await Bun.file(join(cwd, "package.json")).text()));
}

export async function checkGeneratedDependencies(input: CheckInput = {}): Promise<void> {
  const cwd = input.cwd ?? process.cwd();
  const artifactPath = input.artifactPath ?? GENERATED_DEPENDENCIES_ARTIFACT_PATH;
  const baseline = await readBaseline(pklInputForCheck(cwd, input));
  validateParentDependencyDrift(baseline, await readParentPackage(cwd));

  const expectedArtifact = renderGeneratedDependenciesArtifact(baseline);
  const currentArtifact = await Bun.file(join(cwd, artifactPath)).text();
  if (currentArtifact !== expectedArtifact) {
    throw new Error(
      `${artifactPath}: stale Generated Dependency Artifact; run \`bun run generated-dependencies:sync\``,
    );
  }
}

export async function syncGeneratedDependencies(input: SyncInput = {}): Promise<void> {
  const cwd = input.cwd ?? process.cwd();
  const artifactPath = input.artifactPath ?? GENERATED_DEPENDENCIES_ARTIFACT_PATH;
  const baseline = await readBaseline(pklInputForCheck(cwd, input));
  const artifact = renderGeneratedDependenciesArtifact(baseline);
  await mkdir(dirname(join(cwd, artifactPath)), { recursive: true });
  await Bun.write(join(cwd, artifactPath), artifact);
  console.log(`wrote ${artifactPath}`);
}

export function parseGeneratedDependenciesMode(argv: readonly string[]): "write" | "check" {
  const modeFlags = argv.filter((arg) => arg === "--write" || arg === "--check");
  const unknownFlags = argv.filter(
    (arg) => arg.startsWith("--") && !["--write", "--check"].includes(arg),
  );
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown generated dependency option(s): ${unknownFlags.join(", ")}`);
  }
  if (modeFlags.length !== 1) {
    throw new Error("Pass exactly one mode: --write or --check");
  }
  return modeFlags[0] === "--write" ? "write" : "check";
}

async function main(): Promise<void> {
  try {
    const mode = parseGeneratedDependenciesMode(process.argv.slice(2));
    if (mode === "write") {
      await syncGeneratedDependencies();
    } else {
      await checkGeneratedDependencies();
      console.log("OK");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
