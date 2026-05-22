import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  protocolContext,
  runStep,
  runReadOnlyStopSteps,
  stopChangedFilesFromEnv,
  stopValidationFiles,
  stopValidationSteps,
  UnclassifiedStopStepError,
  unclassifiedStopSteps,
} from "./validate-on-stop.ts";

test("stop validation targets code changes with check-level steps", () => {
  expect(
    stopValidationSteps(new Set(["backend", "scripts"]), {
      hasParentToolingCheck: true,
      hasAgentsCheck: true,
    }),
  ).toEqual(["format:check", "lint:errors", "typecheck", "test"]);
});

test("stop validation runs generated dependency checks before product contract checks", () => {
  expect(
    stopValidationSteps(new Set(["product"]), {
      hasParentToolingCheck: true,
      hasAgentsCheck: true,
      includeGeneratedDependenciesCheck: true,
    }),
  ).toEqual(["format:check", "test:project-contract", "generated-dependencies:check"]);
});

test("stop validation includes config sync checks without deep or sandbox lanes", () => {
  expect(
    stopValidationSteps(new Set(["config", "backend", "scripts", "product"]), {
      hasParentToolingCheck: true,
      hasAgentsCheck: true,
      includeGeneratedDependenciesCheck: true,
    }),
  ).toEqual([
    "format:check",
    "lint:errors",
    "typecheck",
    "test",
    "test:project-contract",
    "generated-dependencies:check",
    "parent-tooling:check",
    "agents:check",
  ]);
});

test("stop validation includes generated dependency Pkl files", () => {
  expect(
    stopValidationFiles([
      "config/generated-dependencies/baseline.pkl",
      "assets/brand/logo.png",
      "src/core/generated-project-contract.ts",
    ]),
  ).toEqual([
    "config/generated-dependencies/baseline.pkl",
    "src/core/generated-project-contract.ts",
  ]);
});

test("stop validation accepts explicit hook changed files from the environment", () => {
  expect(
    stopChangedFilesFromEnv({
      KITSMITH_STOP_CHANGED_FILES_JSON: JSON.stringify([
        "src/index.ts",
        "src/index.ts",
        "scripts/validation/run.ts",
      ]),
    }),
  ).toEqual(["scripts/validation/run.ts", "src/index.ts"]);
});

test("stop validation falls back to Git-discovered files outside hook mode", () => {
  expect(stopChangedFilesFromEnv({})).toBeNull();
});

test("stop validation rejects malformed hook changed file payloads", () => {
  expect(() =>
    stopChangedFilesFromEnv({ KITSMITH_STOP_CHANGED_FILES_JSON: JSON.stringify(["src/a.ts", 1]) }),
  ).toThrow("KITSMITH_STOP_CHANGED_FILES_JSON must be a JSON string array.");
});

test("stop validation refuses steps not explicitly classified read-only", () => {
  expect(unclassifiedStopSteps(["format:check", "agents:sync", "typecheck"])).toEqual([
    "agents:sync",
  ]);
});

test("stop validation allows explicitly classified read-only steps", () => {
  expect(
    unclassifiedStopSteps([
      "format:check",
      "lint:errors",
      "typecheck",
      "test",
      "test:project-contract",
      "generated-dependencies:check",
      "parent-tooling:check",
      "agents:check",
    ]),
  ).toEqual([]);
});

test("stop validation refuses unclassified steps before execution", () => {
  const executed: string[] = [];
  const errors: string[] = [];

  expect(() =>
    runReadOnlyStopSteps(["format:check", "agents:sync"], "/tmp", errors, (step) => {
      executed.push(step);
    }),
  ).toThrow(UnclassifiedStopStepError);

  expect(executed).toEqual([]);
  expect(errors).toEqual([]);
});

test("stop validation executes allowed read-only steps", () => {
  const executed: string[] = [];
  const errors: string[] = [];

  runReadOnlyStopSteps(["format:check", "typecheck"], "/tmp/project", errors, (step, cwd) => {
    executed.push(`${cwd}:${step}`);
  });

  expect(executed).toEqual(["/tmp/project:format:check", "/tmp/project:typecheck"]);
});

test("stop validation protocol context does not create output directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-stop-protocol-context-"));
  try {
    const protocol = protocolContext(root, {
      KITSMITH_STOP_RUN_ID: "run",
      KITSMITH_STOP_SESSION_ID: "session",
    });

    expect(protocol?.relativeOutputDir).toBe(
      path.join(".agents", "tmp", "hooks", "stop", "session", "run"),
    );
    expect(await pathExists(path.join(root, ".agents/tmp/hooks/stop/session/run"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stop validation emits JSONL records and captures raw step output in protocol mode", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kitsmith-stop-protocol-"));
  const outputDir = path.join(root, ".agents/tmp/hooks/stop/session/run");
  const relativeOutputDir = ".agents/tmp/hooks/stop/session/run";
  const capturedStdout: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    capturedStdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          noisy:
            "bun -e \"for (let i = 0; i < 120; i++) console.log('wrote file-' + i); console.error('failed reason'); process.exit(7)\"",
        },
      }),
    );
    expect(await pathExists(outputDir)).toBe(false);

    const errors: string[] = [];
    runStep("noisy", root, errors, { runId: "run", outputDir, relativeOutputDir });

    expect(errors[0]).toContain("[noisy]");
    const record: unknown = JSON.parse(capturedStdout.join(""));
    expect(recordProperty(record, "protocol")).toBe("kitsmith.stop-validation");
    expect(recordProperty(record, "version")).toBe(1);
    expect(recordProperty(record, "type")).toBe("failure");
    expect(recordProperty(record, "runId")).toBe("run");
    expect(recordProperty(record, "failureKind")).toBe("validation_failed");
    expect(recordProperty(record, "step")).toBe("noisy");
    expect(recordProperty(record, "exitCode")).toBe(7);
    expect(recordProperty(record, "stdoutTail")).toContain("wrote file-119");
    expect(recordProperty(record, "stderrTail")).toBe("failed reason");
    expect(
      await readFile(path.join(root, String(recordProperty(record, "stdoutRef"))), "utf8"),
    ).toContain("wrote file-0");
    expect(
      await readFile(path.join(root, String(recordProperty(record, "stderrRef"))), "utf8"),
    ).toContain("failed reason");
    expect(await pathExists(outputDir)).toBe(true);
    if (usesPosixFileModeBits()) {
      expect((await stat(outputDir)).mode & 0o777).toBe(0o700);
      expect(
        (await stat(path.join(root, String(recordProperty(record, "stdoutRef"))))).mode & 0o777,
      ).toBe(0o600);
    }
  } finally {
    process.stdout.write = originalWrite;
    await rm(root, { recursive: true, force: true });
  }
});

function recordProperty(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath).then(
    () => true,
    (error: unknown) => {
      if (errorCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    },
  );
}

function usesPosixFileModeBits(): boolean {
  return process.platform !== "win32";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
