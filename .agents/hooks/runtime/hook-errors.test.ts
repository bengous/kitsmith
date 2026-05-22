import type {
  AgentAdapter,
  AgentFeedbackResult,
  AgentHookEvent,
  AgentHookKind,
} from "../core/contract.ts";
import { describe, expect, test } from "bun:test";
import { runPostEditHook } from "./run-post-edit-hook.ts";
import { runDestructiveCommandGuard, runEditPathGuard } from "./run-pre-tool-hook.ts";
import { runStopHook } from "./run-stop-hook.ts";

type CapturedOutput =
  | {
      readonly kind: "post-edit";
      readonly result: AgentFeedbackResult;
      readonly event: AgentHookEvent;
    }
  | { readonly kind: "stop"; readonly result: AgentFeedbackResult }
  | { readonly kind: "pre-tool"; readonly reason: string };

function throwingAdapter(outputs: CapturedOutput[], error: unknown): AgentAdapter {
  return {
    agent: "test-agent",
    capabilities: { updatedToolOutput: false },
    readEvent: async (_hook: AgentHookKind) => {
      throw error;
    },
    printPostEditResult: (result, event) => {
      outputs.push({ kind: "post-edit", result, event });
    },
    printStopResult: (result) => {
      outputs.push({ kind: "stop", result });
    },
    printPreToolDeny: (reason) => {
      outputs.push({ kind: "pre-tool", reason });
    },
  };
}

describe("hook runtime failures", () => {
  test("post-edit hook blocks cleanly when event parsing fails", async () => {
    const outputs: CapturedOutput[] = [];

    await runPostEditHook(throwingAdapter(outputs, new SyntaxError("Unexpected token")));

    expect(outputs).toHaveLength(1);
    const output = outputs[0];
    expect(output?.kind).toBe("post-edit");
    if (output?.kind !== "post-edit") {
      throw new Error("Expected post-edit output");
    }
    expect(output.result.blockReason).toContain(
      "Post-edit hook failed before validation could complete.",
    );
    expect(output.result.blockReason).toContain("Check that the hook payload is valid JSON");
    expect(output.event).toEqual({
      agent: "test-agent",
      hook: "post-edit",
      touchedPathCandidates: [],
    });
  });

  test("stop hook blocks cleanly when event parsing fails", async () => {
    const outputs: CapturedOutput[] = [];

    await runStopHook(throwingAdapter(outputs, new SyntaxError("Unexpected token")));

    expect(outputs).toHaveLength(1);
    const output = outputs[0];
    expect(output?.kind).toBe("stop");
    if (output?.kind !== "stop") {
      throw new Error("Expected stop output");
    }
    expect(output.result.blockReason).toContain(
      "Stop hook failed before validation could complete.",
    );
    expect(output.result.blockReason).toContain("Check that the hook payload is valid JSON");
  });

  test("pre-tool guards deny cleanly when event parsing fails", async () => {
    const destructiveOutputs: CapturedOutput[] = [];
    const editPathOutputs: CapturedOutput[] = [];

    await runDestructiveCommandGuard(
      throwingAdapter(destructiveOutputs, new SyntaxError("Unexpected token")),
    );
    await runEditPathGuard(throwingAdapter(editPathOutputs, new Error("state write failed")));

    expect(destructiveOutputs[0]?.kind).toBe("pre-tool");
    expect(editPathOutputs[0]?.kind).toBe("pre-tool");
    if (destructiveOutputs[0]?.kind !== "pre-tool" || editPathOutputs[0]?.kind !== "pre-tool") {
      throw new Error("Expected pre-tool outputs");
    }
    expect(destructiveOutputs[0].reason).toContain(
      "Pre-tool hook failed before validation could complete.",
    );
    expect(editPathOutputs[0].reason).toContain(
      "Check the hook configuration and project dependencies",
    );
  });
});
