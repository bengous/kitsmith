import { describe, expect, test } from "bun:test";
import { runWithConcurrency, scenarioJobs } from "./scenario-concurrency.ts";

async function unusedScenarioTask(): Promise<void> {}

async function expectRejectsWithMessage(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(String(error)).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected action to reject with ${expectedMessage}`);
}

describe("scenarioJobs", () => {
  test("uses the local default outside CI", () => {
    expect(
      scenarioJobs({
        argv: ["bun", "script.ts"],
        env: {},
        envName: "KITSMITH_TEST_JOBS",
        localDefault: 3,
      }),
    ).toBe(3);
  });

  test("defaults to one job in CI", () => {
    expect(
      scenarioJobs({
        argv: ["bun", "script.ts"],
        env: { CI: "true" },
        envName: "KITSMITH_TEST_JOBS",
        localDefault: 3,
      }),
    ).toBe(1);
  });

  test("prefers the CLI flag over the environment", () => {
    expect(
      scenarioJobs({
        argv: ["bun", "script.ts", "--jobs", "2"],
        env: { CI: "true", KITSMITH_TEST_JOBS: "1" },
        envName: "KITSMITH_TEST_JOBS",
        localDefault: 3,
      }),
    ).toBe(2);
  });

  test("fails fast for invalid explicit values", () => {
    expect(() =>
      scenarioJobs({
        argv: ["bun", "script.ts", "--jobs", "0"],
        env: {},
        envName: "KITSMITH_TEST_JOBS",
        localDefault: 3,
      }),
    ).toThrow("Expected --jobs");

    expect(() =>
      scenarioJobs({
        argv: ["bun", "script.ts"],
        env: { KITSMITH_TEST_JOBS: "nope" },
        envName: "KITSMITH_TEST_JOBS",
        localDefault: 3,
      }),
    ).toThrow("Expected KITSMITH_TEST_JOBS");
  });
});

describe("runWithConcurrency", () => {
  test("runs every item with bounded concurrency", async () => {
    const completed: number[] = [];
    let active = 0;
    let maxActive = 0;

    await runWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(1);
      completed.push(value);
      active -= 1;
    });

    expect(completed.toSorted((left, right) => left - right)).toEqual([1, 2, 3, 4]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  test("rejects invalid concurrency", async () => {
    await expectRejectsWithMessage(
      async () => runWithConcurrency([1], 0, unusedScenarioTask),
      "Expected jobs",
    );
  });
});
