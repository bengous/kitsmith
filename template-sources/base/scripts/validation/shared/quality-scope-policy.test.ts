import { describe, expect, test } from "bun:test";
import { classifyRoutingPath, resolveQualityWorkspace } from "./quality-scope-policy.ts";

const CONTEXT = {
  kind: "generated-project",
  presence: {
    backend: true,
    frontend: false,
  },
} as const;

describe("quality scope policy", () => {
  test("routes shared agent hook sources as project scripts", () => {
    expect(classifyRoutingPath(".agents/scripts/hooks/core/contract.ts", CONTEXT)).toBe("scripts");
  });

  test("runs root quality tooling for shared agent hook sources", () => {
    expect(resolveQualityWorkspace(".agents/scripts/hooks/core/contract.ts", CONTEXT)?.name).toBe(
      "root",
    );
  });
});
