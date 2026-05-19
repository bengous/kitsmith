import type {
  AdoptOptions,
  AdoptOptionsInput,
  BackupRunId,
  BinName,
  LintSeverity,
  PackageName,
  SafeRelativePath,
  TemplateContext,
} from "../types.ts";
import type {
  GeneratedProjectDescription,
  PresetCopySpec,
  TemplateRenderSpec,
} from "./generated-project-contract.ts";
import type { JsonObject } from "./json.ts";
import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { brandValue } from "../types.ts";
import {
  adoptionTemplatePolicy,
  frontendConflictReason,
  isNonDirectoryParentConflict,
  mergeAdoptedPackageJson,
  presetAdoptionReason,
  presetMismatchPolicy,
  shouldOmitPresetDuringAdopt,
  shouldOmitTemplateDuringAdopt,
} from "./adoption-policy.ts";
import { describeGeneratedProject } from "./generated-project-contract.ts";
import { finalizeProject, runCommand } from "./install.ts";
import { isJsonObject, objectField, parseJsonObject, readJsonObject } from "./json.ts";
import {
  toExistingBinName,
  toExistingPackageName,
  toPackageName,
  toProjectName,
} from "./naming.ts";
import { renderTemplate } from "./template.ts";

type WritableAdoptionAction = Extract<AdoptionAction, { readonly kind: "create" | "modify" }>;

export type AdoptionAction =
  | {
      readonly kind: "create";
      readonly path: SafeRelativePath;
      readonly reason: string;
      readonly content: string;
    }
  | {
      readonly kind: "modify";
      readonly path: SafeRelativePath;
      readonly reason: string;
      readonly content: string;
    }
  | {
      readonly kind: "skip";
      readonly path: SafeRelativePath;
      readonly reason: string;
    }
  | {
      readonly kind: "conflict";
      readonly path: SafeRelativePath;
      readonly reason: string;
    };

export type AdoptionPlan = {
  readonly destination: string;
  readonly runId: BackupRunId;
  readonly actions: AdoptionAction[];
};

type BackupEntry = {
  readonly path: SafeRelativePath;
  readonly kind: "created" | "modified";
  readonly backupPath?: SafeRelativePath;
};

type BackupManifest = {
  readonly runId: BackupRunId;
  readonly entries: BackupEntry[];
};

type FileContentMismatch =
  | { readonly kind: "skip"; readonly reason: string }
  | { readonly kind: "conflict"; readonly reason: string };

export type AdoptRuntime = {
  readonly now: () => Date;
  readonly runCommand: typeof runCommand;
  readonly finalizeProject: typeof finalizeProject;
};

export const defaultAdoptRuntime: AdoptRuntime = {
  now: () => new Date(),
  runCommand,
  finalizeProject,
};

function backupRoot(destination: string, runId: BackupRunId): string {
  return join(destination, ".kitsmith", "backups", runId);
}

function backupFilePath(relativePath: SafeRelativePath): SafeRelativePath {
  return toSafeRelativePath(join("files", encodeURIComponent(relativePath)));
}

export function toSafeRelativePath(relativePath: string): SafeRelativePath {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.includes("/../")
  ) {
    throw new Error(`Unsafe adoption path: ${relativePath}`);
  }
  return brandValue<string, "SafeRelativePath">(relativePath);
}

export function toBackupRunId(runId: string): BackupRunId {
  if (
    runId.length === 0 ||
    runId === "." ||
    runId === ".." ||
    runId.includes("/") ||
    runId.includes("\\")
  ) {
    throw new Error(`Unsafe adoption rollback run id: ${runId}`);
  }
  return brandValue<string, "BackupRunId">(runId);
}

function blockingParentPath(
  destination: string,
  relativePath: SafeRelativePath,
): string | undefined {
  const segments = relativePath.split("/");
  const parents = segments.slice(0, -1);
  let cursor = destination;

  for (const parent of parents) {
    cursor = join(cursor, parent);
    if (existsSync(cursor) && !statSync(cursor).isDirectory()) {
      return relative(destination, cursor);
    }
  }

  return undefined;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function renderJsonTemplate(templateName: string, context: TemplateContext): JsonObject {
  return parseJsonObject(renderTemplate(templateName, context), templateName);
}

function packageHasBunSignal(packageJson: JsonObject): boolean {
  const scripts = objectField(packageJson, "scripts");
  const dependencies = objectField(packageJson, "dependencies");
  const devDependencies = objectField(packageJson, "devDependencies");
  const bin = packageJson["bin"];
  const scriptValues = Object.values(scripts);

  return (
    scriptValues.some((value) => typeof value === "string" && value.includes("bun")) ||
    "@types/bun" in devDependencies ||
    "bun-types" in devDependencies ||
    "bun" in dependencies ||
    (isJsonObject(bin) &&
      Object.values(bin).some((value) => typeof value === "string" && value.endsWith(".ts")))
  );
}

async function assertAdoptableProject(destination: string): Promise<JsonObject> {
  const packagePath = join(destination, "package.json");
  const tsconfigPath = join(destination, "tsconfig.json");

  if (!existsSync(packagePath)) {
    throw new Error("Adoption requires an existing package.json");
  }
  if (!existsSync(tsconfigPath)) {
    throw new Error("Adoption requires an existing tsconfig.json");
  }

  const packageJson = await readJsonObject(packagePath);
  if (!packageHasBunSignal(packageJson)) {
    throw new Error("Adoption currently supports Bun/TypeScript projects only");
  }

  return packageJson;
}

function packageName(packageJson: JsonObject, destination: string): PackageName {
  const name = packageJson["name"];
  return toExistingPackageName(
    typeof name === "string" && name.length > 0 ? name : basename(destination),
  );
}

function binName(packageJson: JsonObject, fallback: string): BinName {
  const bin = packageJson["bin"];
  if (isJsonObject(bin)) {
    const first = Object.keys(bin)[0];
    if (first !== undefined) {
      return toExistingBinName(first);
    }
  }
  return toExistingBinName(fallback);
}

function isKitsmithParentRepo(destination: string): boolean {
  return (
    existsSync(join(destination, "template-sources/manifest.json")) &&
    existsSync(join(destination, "src/core/generated-project-contract.ts"))
  );
}

function assertNotKitsmithParentSelfAdoption(options: AdoptOptions): void {
  if (String(options.packageName) !== "kitsmith" || !isKitsmithParentRepo(options.destination)) {
    return;
  }

  throw new Error(
    "Kitsmith parent tooling is maintained with `bun run parent-tooling:sync`, `bun run agents:sync`, and `bun run parent-tooling:check`; `kitsmith adopt .` is for external Bun projects.",
  );
}

function describeAdoptedProject(options: AdoptOptions): GeneratedProjectDescription {
  return describeGeneratedProject({
    destination: options.destination,
    projectName: options.projectName,
    packageName: options.packageName,
    binName: options.binName,
    backend: true,
    frontend: options.frontend,
    ai: options.ai,
    effect: options.effect,
    install: options.install,
    gitInit: false,
    yes: options.yes,
  });
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function planStaticFile(
  destination: string,
  sourceRoot: string,
  relativePath: string,
  reason: string,
  lintSeverity: LintSeverity,
): Promise<AdoptionAction> {
  const safePath = toSafeRelativePath(relativePath);
  const raw = await readText(join(sourceRoot, safePath));
  const content = adoptionStaticFileContent(relativePath, raw, lintSeverity);
  return planFileContent(destination, safePath, content, reason, (mismatchReason) =>
    presetMismatchPolicy(relativePath, reason, mismatchReason),
  );
}

async function planPresetCopySpec(
  destination: string,
  spec: PresetCopySpec,
  lintSeverity: LintSeverity,
): Promise<AdoptionAction[]> {
  const reason = presetAdoptionReason(spec.name);
  return Promise.all(
    spec.relativePaths.map(async (path) =>
      planStaticFile(destination, spec.sourceDir, path, reason, lintSeverity),
    ),
  );
}

function adoptionStaticFileContent(
  relativePath: string,
  content: string,
  lintSeverity: LintSeverity,
): string {
  if (lintSeverity === "error" || !relativePath.endsWith(".oxlintrc.jsonc")) {
    return content;
  }

  return content.replaceAll('"error"', '"warn"');
}

async function planPackageJson(
  destination: string,
  description: GeneratedProjectDescription,
): Promise<AdoptionAction> {
  const context = description.templateContext;
  const relativePath = toSafeRelativePath("package.json");
  const packagePath = join(destination, relativePath);
  const current = await readText(packagePath);
  const existing = parseJsonObject(current, packagePath);
  const expected = renderJsonTemplate("package.json.tpl", context);
  const merged = mergeAdoptedPackageJson(existing, expected, context);
  const content = stableJson(merged);

  if (current === content) {
    return {
      kind: "skip",
      path: relativePath,
      reason: "package.json already has Kitsmith wiring",
    };
  }

  return {
    kind: "modify",
    path: relativePath,
    reason: "Merge Kitsmith scripts and dependencies without overwriting existing entries",
    content,
  };
}

async function planPreservedTemplateFile(
  destination: string,
  context: TemplateContext,
  templateName: string,
  relativePath: string,
  createReason: string,
  preserveReason: string,
): Promise<AdoptionAction> {
  return planRenderedTemplateFile(
    destination,
    context,
    templateName,
    relativePath,
    createReason,
    (mismatchReason) => ({
      kind: isNonDirectoryParentConflict(mismatchReason) ? "conflict" : "skip",
      reason: isNonDirectoryParentConflict(mismatchReason) ? mismatchReason : preserveReason,
    }),
  );
}

async function planTemplateFile(
  destination: string,
  context: TemplateContext,
  templateName: string,
  relativePath: string,
  createReason: string,
  conflictReason: string,
): Promise<AdoptionAction> {
  return planRenderedTemplateFile(
    destination,
    context,
    templateName,
    relativePath,
    createReason,
    (mismatchReason) => ({
      kind: "conflict",
      reason: isNonDirectoryParentConflict(mismatchReason) ? mismatchReason : conflictReason,
    }),
  );
}

async function planRenderedTemplateFile(
  destination: string,
  context: TemplateContext,
  templateName: string,
  relativePath: string,
  createReason: string,
  mismatch: (reason: string) => FileContentMismatch,
): Promise<AdoptionAction> {
  const safePath = toSafeRelativePath(relativePath);
  const content = renderTemplate(templateName, context);
  return planFileContent(destination, safePath, content, createReason, mismatch);
}

async function planFileContent(
  destination: string,
  safePath: SafeRelativePath,
  content: string,
  createReason: string,
  mismatch: (reason: string) => FileContentMismatch,
): Promise<AdoptionAction> {
  const target = join(destination, safePath);
  const blockedBy = blockingParentPath(destination, safePath);
  if (blockedBy !== undefined) {
    const mismatchPolicy = mismatch(
      `Cannot create below existing non-directory path: ${blockedBy}`,
    );
    return { ...mismatchPolicy, path: safePath };
  }
  if (!existsSync(target)) {
    return { kind: "create", path: safePath, reason: createReason, content };
  }

  const existing = await readText(target);
  if (existing === content) {
    return { kind: "skip", path: safePath, reason: "Already matches Kitsmith output" };
  }

  return { ...mismatch("Existing file differs from Kitsmith output"), path: safePath };
}

function hasExistingFrontend(
  destination: string,
  description: GeneratedProjectDescription,
): boolean {
  return (
    description.shape.frontend === "tanstack" && existsSync(join(destination, "apps/frontend"))
  );
}

async function planPresetCopySpecs(
  destination: string,
  description: GeneratedProjectDescription,
  lintSeverity: LintSeverity,
): Promise<AdoptionAction[]> {
  const preserveExistingFrontend = hasExistingFrontend(destination, description);
  const specs = description.presetCopySpecs.filter(
    (spec) => !shouldOmitPresetDuringAdopt(spec, preserveExistingFrontend),
  );
  const actionSets = await Promise.all(
    specs.map(async (spec) => planPresetCopySpec(destination, spec, lintSeverity)),
  );
  return actionSets.flat();
}

async function planTemplateSpec(
  destination: string,
  description: GeneratedProjectDescription,
  spec: TemplateRenderSpec,
): Promise<AdoptionAction> {
  const policy = adoptionTemplatePolicy(spec);

  if (policy.kind === "package-json") {
    return planPackageJson(destination, description);
  }

  if (policy.kind === "skip") {
    return {
      kind: "skip",
      path: toSafeRelativePath(policy.path),
      reason: policy.reason,
    };
  }

  if (policy.kind === "preserve-existing") {
    return planPreservedTemplateFile(
      destination,
      description.templateContext,
      spec.templateName,
      policy.path,
      policy.createReason,
      policy.preserveReason,
    );
  }

  return planTemplateFile(
    destination,
    description.templateContext,
    spec.templateName,
    policy.path,
    policy.createReason,
    policy.conflictReason,
  );
}

async function planTemplateRenderSpecs(
  destination: string,
  description: GeneratedProjectDescription,
): Promise<AdoptionAction[]> {
  const preserveExistingFrontend = hasExistingFrontend(destination, description);
  const specs = description.templateRenderSpecs.filter(
    (spec) => !shouldOmitTemplateDuringAdopt(spec, preserveExistingFrontend),
  );
  return Promise.all(specs.map(async (spec) => planTemplateSpec(destination, description, spec)));
}

function planExistingFrontendConflict(
  destination: string,
  description: GeneratedProjectDescription,
): AdoptionAction[] {
  if (!hasExistingFrontend(destination, description)) {
    return [];
  }

  return [
    {
      kind: "conflict",
      path: toSafeRelativePath("apps/frontend"),
      reason: frontendConflictReason(),
    },
  ];
}

export function normalizeAdoptOptions(
  destinationArg: string | undefined,
  flags: AdoptOptionsInput,
): AdoptOptions {
  const destination = resolve(flags.destination ?? destinationArg ?? ".");
  const fallbackName = basename(destination);
  const projectName = toProjectName(flags.projectName ?? fallbackName);
  const packageNameValue =
    flags.packageName !== undefined
      ? toExistingPackageName(flags.packageName)
      : toPackageName(projectName);
  return {
    destination,
    projectName,
    packageName: packageNameValue,
    binName:
      flags.binName !== undefined
        ? toExistingBinName(flags.binName)
        : toExistingBinName(packageNameValue),
    frontend: flags.frontend ?? "none",
    ai: flags.ai ?? true,
    effect: flags.effect ?? false,
    install: flags.install ?? false,
    lintSeverity: flags.lintSeverity ?? "warn",
    apply: flags.apply ?? false,
    rollback: flags.rollback !== undefined ? toBackupRunId(flags.rollback) : undefined,
    yes: flags.yes ?? false,
  };
}

export async function deriveAdoptOptions(
  destinationArg: string | undefined,
  flags: AdoptOptionsInput,
): Promise<AdoptOptions> {
  const normalized = normalizeAdoptOptions(destinationArg, flags);
  const packageJson = await assertAdoptableProject(normalized.destination);
  const name = packageName(packageJson, normalized.destination);
  return {
    ...normalized,
    projectName:
      flags.projectName !== undefined ? toProjectName(flags.projectName) : toProjectName(name),
    packageName: flags.packageName !== undefined ? toExistingPackageName(flags.packageName) : name,
    binName:
      flags.binName !== undefined ? toExistingBinName(flags.binName) : binName(packageJson, name),
  };
}

export async function buildAdoptionPlan(
  options: AdoptOptions,
  runtime: AdoptRuntime = defaultAdoptRuntime,
): Promise<AdoptionPlan> {
  await assertAdoptableProject(options.destination);
  assertNotKitsmithParentSelfAdoption(options);
  const description = describeAdoptedProject(options);
  const actions: AdoptionAction[] = [
    ...(await planPresetCopySpecs(options.destination, description, options.lintSeverity)),
    ...(await planTemplateRenderSpecs(options.destination, description)),
    ...planExistingFrontendConflict(options.destination, description),
  ];

  return {
    destination: options.destination,
    runId: toBackupRunId(runtime.now().toISOString().replaceAll(/[:.]/g, "-")),
    actions,
  };
}

async function backupExistingFile(
  destination: string,
  root: string,
  relativePath: SafeRelativePath,
): Promise<SafeRelativePath> {
  const backupPath = backupFilePath(relativePath);
  const absoluteBackupPath = join(root, backupPath);
  await mkdir(dirname(absoluteBackupPath), { recursive: true });
  await copyFile(join(destination, relativePath), absoluteBackupPath);
  return backupPath;
}

export async function applyAdoptionPlan(
  plan: AdoptionPlan,
  options: AdoptOptions,
  runtime: AdoptRuntime = defaultAdoptRuntime,
): Promise<BackupManifest> {
  const manifest: BackupManifest = { runId: plan.runId, entries: [] };
  const root = backupRoot(plan.destination, plan.runId);
  const writableActions = plan.actions.filter(
    (action): action is WritableAdoptionAction =>
      action.kind === "create" || action.kind === "modify",
  );

  await Promise.all(
    writableActions.map(async (action) => {
      if (action.kind === "modify") {
        const backupPath = await backupExistingFile(plan.destination, root, action.path);
        manifest.entries.push({ path: action.path, kind: "modified", backupPath });
      } else {
        manifest.entries.push({ path: action.path, kind: "created" });
      }

      await writeText(join(plan.destination, action.path), action.content);
    }),
  );

  await writeText(join(root, "manifest.json"), stableJson(manifest));

  if (options.ai && existsSync(join(options.destination, "scripts/agents/sync-agents-md.ts"))) {
    await runtime.runCommand(
      ["bun", "scripts/agents/sync-agents-md.ts", "--write", "--preserve-root"],
      options.destination,
    );
  }

  if (options.install) {
    await runtime.finalizeProject({ ...options, backend: true, ai: false, gitInit: false });
  }

  return manifest;
}

export async function rollbackAdoption(
  destination: string,
  runId: string,
): Promise<BackupManifest> {
  const safeRunId = toBackupRunId(runId);
  const root = backupRoot(destination, safeRunId);
  const manifest = parseJsonObject(
    await readText(join(root, "manifest.json")),
    join(root, "manifest.json"),
  );
  if (
    !isJsonObject(manifest) ||
    typeof manifest["runId"] !== "string" ||
    !Array.isArray(manifest["entries"])
  ) {
    throw new TypeError(`Invalid adoption rollback manifest: ${join(root, "manifest.json")}`);
  }

  const entries: BackupEntry[] = manifest["entries"].map((entry) => {
    if (
      !isJsonObject(entry) ||
      typeof entry["path"] !== "string" ||
      typeof entry["kind"] !== "string"
    ) {
      throw new TypeError("Invalid adoption rollback manifest entry");
    }
    if (entry["kind"] === "created") {
      return { path: toSafeRelativePath(entry["path"]), kind: "created" };
    }
    if (entry["kind"] === "modified" && typeof entry["backupPath"] === "string") {
      return {
        path: toSafeRelativePath(entry["path"]),
        kind: "modified",
        backupPath: toSafeRelativePath(entry["backupPath"]),
      };
    }
    throw new TypeError("Invalid adoption rollback manifest entry");
  });

  await entries
    .toReversed()
    .reduce(
      async (previous, entry) =>
        previous.then(async () => rollbackBackupEntry(destination, root, entry)),
      Promise.resolve(),
    );

  return { runId: toBackupRunId(manifest["runId"]), entries };
}

async function rollbackBackupEntry(
  destination: string,
  root: string,
  entry: BackupEntry,
): Promise<void> {
  const target = join(destination, entry.path);
  if (entry.kind === "created") {
    await rm(target, { recursive: true, force: true });
  } else if (entry.backupPath !== undefined) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, entry.backupPath), target);
  }
}

export function formatAdoptionPlan(plan: AdoptionPlan): string {
  const counts: Record<AdoptionAction["kind"], number> = {
    conflict: 0,
    create: 0,
    modify: 0,
    skip: 0,
  };
  for (const action of plan.actions) {
    counts[action.kind] += 1;
  }

  const lines = [
    `Adoption plan for ${plan.destination}`,
    `runId: ${plan.runId}`,
    `create: ${counts.create}, modify: ${counts.modify}, skip: ${counts.skip}, conflict: ${counts.conflict}`,
  ];

  for (const action of plan.actions) {
    lines.push(`${action.kind.padEnd(8)} ${action.path} - ${action.reason}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function adoptProject(
  options: AdoptOptions,
  runtime: AdoptRuntime = defaultAdoptRuntime,
): Promise<AdoptionPlan> {
  if (options.rollback !== undefined) {
    await rollbackAdoption(options.destination, options.rollback);
    return { destination: options.destination, runId: options.rollback, actions: [] };
  }

  const plan = await buildAdoptionPlan(options, runtime);
  if (options.apply) {
    await applyAdoptionPlan(plan, options, runtime);
  }
  return plan;
}
