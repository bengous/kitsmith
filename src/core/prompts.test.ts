import type { FrontendPreset, InitOptions } from "../types.ts";
import type { PromptRuntime } from "./prompts.ts";
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  collectAdoptOptionsWithRuntime,
  collectOptionsWithRuntime,
  defaultPromptRuntime,
  normalizeFlagOptions,
} from "./prompts.ts";

const cancelled = Symbol("cancelled");

function plainOptions(options: InitOptions): Omit<
  InitOptions,
  "projectName" | "packageName" | "binName"
> & {
  readonly projectName: string;
  readonly packageName: string;
  readonly binName: string;
} {
  return {
    ...options,
    projectName: String(options.projectName),
    packageName: String(options.packageName),
    binName: String(options.binName),
  };
}

function createPromptRuntime(
  responses: {
    readonly texts?: Array<string | symbol>;
    readonly selects?: Array<FrontendPreset | "warn" | "error" | symbol>;
    readonly confirms?: Array<boolean | symbol>;
  },
  resolvedPrefix = "/tmp",
): PromptRuntime {
  const textQueue = [...(responses.texts ?? [])];
  const selectQueue = [...(responses.selects ?? [])];
  const confirmQueue = [...(responses.confirms ?? [])];

  return {
    ...defaultPromptRuntime,
    intro() {},
    outro() {},
    text: async () => nextResponse(textQueue, "text"),
    select: async () => nextResponse(selectQueue, "select"),
    confirm: async () => nextResponse(confirmQueue, "confirm"),
    isCancel: (value: unknown) => value === cancelled,
    resolvePath: (value: string) => (value.startsWith("/") ? value : `${resolvedPrefix}/${value}`),
  };
}

function nextResponse<T>(queue: T[], kind: string): T {
  const response = queue.shift();
  if (response === undefined) {
    throw new Error(`Missing queued ${kind} prompt response`);
  }
  return response;
}

describe("normalizeFlagOptions", () => {
  test("derives defaults from destination and project name", () => {
    const normalized = normalizeFlagOptions("My App", {});
    expect(plainOptions(normalized)).toMatchObject({
      projectName: "my-app",
      packageName: "my-app",
      binName: "my-app",
      backend: true,
      frontend: "none",
      ai: true,
      effect: false,
      install: true,
      gitInit: true,
      yes: false,
    });
    expect(normalized.destination.endsWith(join("My App"))).toBe(true);
  });

  test("respects explicit flags", () => {
    const normalized = normalizeFlagOptions("ignored", {
      destination: "/work/custom",
      projectName: "Chosen Name",
      packageName: "pkg-name",
      binName: "custom-bin",
      backend: true,
      frontend: "tanstack",
      ai: false,
      install: false,
      gitInit: false,
      yes: true,
    });

    expect(plainOptions(normalized)).toEqual({
      destination: resolve("/work/custom"),
      projectName: "chosen-name",
      packageName: "pkg-name",
      binName: "custom-bin",
      backend: true,
      frontend: "tanstack",
      ai: false,
      effect: false,
      install: false,
      gitInit: false,
      yes: true,
    });
  });

  test("derives the default name from the destination basename", () => {
    const normalized = normalizeFlagOptions("/tmp/nested/Fancy Project", {});
    expect(String(normalized.projectName)).toBe("fancy-project");
    expect(String(normalized.packageName)).toBe("fancy-project");
    expect(String(normalized.binName)).toBe("fancy-project");
    expect(normalized.destination.endsWith(join("tmp", "nested", "Fancy Project"))).toBe(true);
  });

  test("rejects an explicit empty project name", () => {
    expect(() =>
      normalizeFlagOptions("/tmp/forge", {
        projectName: "   ",
      }),
    ).toThrow("Project name must not be empty");
  });

  test("rejects frontend-less projects without a backend", () => {
    expect(() =>
      normalizeFlagOptions("/tmp/forge", {
        backend: false,
        frontend: "none",
      }),
    ).toThrow("Backend cannot be disabled without a frontend preset");
  });

  test("rejects Effect without a backend starter", () => {
    expect(() =>
      normalizeFlagOptions("/tmp/forge", {
        backend: false,
        frontend: "tanstack",
        effect: true,
      }),
    ).toThrow("Effect starter requires the backend preset");
  });
});

describe("collectOptionsWithRuntime", () => {
  test("collects answers from prompts and resolves the destination", async () => {
    const options = await collectOptionsWithRuntime(
      undefined,
      {},
      createPromptRuntime(
        {
          texts: ["Forge App"],
          selects: ["tanstack"],
          confirms: [true, true, true, false, true],
        },
        "/workspace",
      ),
    );

    expect(plainOptions(options)).toEqual({
      destination: "/workspace/Forge App",
      projectName: "Forge App",
      packageName: "forge-app",
      binName: "forge-app",
      backend: true,
      frontend: "tanstack",
      ai: true,
      effect: true,
      install: false,
      gitInit: true,
      yes: false,
    });
  });

  test("uses flag values instead of prompting when already provided", async () => {
    const options = await collectOptionsWithRuntime(
      "starter",
      {
        projectName: "starter",
        destination: "/repo/starter",
        backend: true,
        frontend: "none",
        ai: false,
        effect: false,
        install: false,
        gitInit: false,
      },
      createPromptRuntime({}, "/ignored"),
    );

    expect(plainOptions(options)).toEqual({
      destination: "/repo/starter",
      projectName: "starter",
      packageName: "starter",
      binName: "starter",
      backend: true,
      frontend: "none",
      ai: false,
      effect: false,
      install: false,
      gitInit: false,
      yes: false,
    });
  });

  test("throws when a prompt is cancelled", async () => {
    try {
      await collectOptionsWithRuntime(undefined, {}, createPromptRuntime({ texts: [cancelled] }));
      throw new Error("Expected prompt collection to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toContain("Cancelled");
    }
  });

  test("uses the destination basename as the interactive default name", async () => {
    const options = await collectOptionsWithRuntime(
      "/tmp/absolute/Forge App",
      {},
      createPromptRuntime({
        texts: ["Forge App"],
        selects: ["none"],
        confirms: [true, true, false, true, true],
      }),
    );

    expect(String(options.projectName)).toBe("Forge App");
    expect(String(options.packageName)).toBe("forge-app");
    expect(options.destination).toBe("/tmp/absolute/Forge App");
  });

  test("rejects an empty interactive project name", async () => {
    try {
      await collectOptionsWithRuntime(
        "/tmp/forge",
        {},
        createPromptRuntime({
          texts: ["   "],
          selects: ["none"],
          confirms: [true, false, true, true],
        }),
      );
      throw new Error("Expected empty project name to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) {
        throw error;
      }
      expect(error.message).toContain("Project name must not be empty");
    }
  });
});

describe("collectAdoptOptionsWithRuntime", () => {
  test("prompts for adoption lint severity", async () => {
    const root = "/tmp/adopt-prompts";
    mkdirSync(root, { recursive: true });
    await Bun.write(
      `${root}/package.json`,
      JSON.stringify({ name: "adopt-prompts", scripts: { dev: "bun src/index.ts" } }),
    );
    await Bun.write(`${root}/tsconfig.json`, '{"compilerOptions":{}}\n');

    const options = await collectAdoptOptionsWithRuntime(
      root,
      { yes: false },
      createPromptRuntime({ selects: ["error"] }),
    );

    expect(options.lintSeverity).toBe("error");
  });

  test("uses explicit adoption lint severity without prompting", async () => {
    const root = "/tmp/adopt-prompts-explicit";
    mkdirSync(root, { recursive: true });
    await Bun.write(
      `${root}/package.json`,
      JSON.stringify({ name: "adopt-prompts-explicit", scripts: { dev: "bun src/index.ts" } }),
    );
    await Bun.write(`${root}/tsconfig.json`, '{"compilerOptions":{}}\n');

    const options = await collectAdoptOptionsWithRuntime(
      root,
      { lintSeverity: "warn", yes: false },
      createPromptRuntime({}),
    );

    expect(options.lintSeverity).toBe("warn");
  });
});
