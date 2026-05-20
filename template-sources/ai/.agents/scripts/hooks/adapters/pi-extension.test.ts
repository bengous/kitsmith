// oxlint-disable typescript/no-unsafe-type-assertion, typescript/await-thenable -- This file tests Pi's structurally typed extension registration boundary.
import { describe, expect, test } from "bun:test";
import { registerKitsmithHooks } from "../../../../.pi/extensions/kitsmith-hooks.ts";

type RegisteredHandlers = {
  readonly tool_call: (event: {
    readonly toolName: string;
    readonly toolCallId: string;
    readonly input: unknown;
  }) => Promise<unknown>;
  readonly tool_result: (event: {
    readonly toolName: string;
    readonly toolCallId: string;
    readonly input: unknown;
    readonly isError: boolean;
  }) => Promise<unknown>;
  readonly agent_end: (
    event: unknown,
    ctx: {
      readonly sessionManager: { readonly getSessionFile: () => string | undefined };
      readonly ui: {
        readonly notify: (message: string, level: "error" | "info" | "warning") => void;
      };
    },
  ) => Promise<void>;
};

type HookCall = {
  readonly script: string;
  readonly payload: Record<string, unknown>;
};

function registerWith(
  results: readonly (
    | { readonly ok: true; readonly context?: string }
    | { readonly ok: false; readonly message: string }
  )[],
): {
  readonly handlers: RegisteredHandlers;
  readonly calls: readonly HookCall[];
} {
  const handlers = {} as Record<string, unknown>;
  const calls: HookCall[] = [];
  let index = 0;

  registerKitsmithHooks(
    {
      on(event: string, handler: unknown): void {
        handlers[event] = handler;
      },
    } as never,
    (script, payload) => {
      calls.push({ script, payload: payload as unknown as Record<string, unknown> });
      return results[index++] ?? { ok: true };
    },
  );

  return { handlers: handlers as unknown as RegisteredHandlers, calls };
}

describe("Pi Kitsmith extension", () => {
  test("allows safe bash commands", async () => {
    const { handlers, calls } = registerWith([{ ok: true }]);

    await expect(
      handlers.tool_call({
        toolName: "bash",
        toolCallId: "tool-1",
        input: { command: "git status" },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toMatchObject([
      {
        script: ".pi/hooks/guard-destructive.ts",
        payload: { hook: "pre-tool", eventId: "tool-1", toolName: "bash", command: "git status" },
      },
    ]);
  });

  test("blocks destructive bash commands", async () => {
    const { handlers } = registerWith([{ ok: false, message: "Destructive command blocked" }]);

    await expect(
      handlers.tool_call({
        toolName: "bash",
        toolCallId: "tool-1",
        input: { command: "rm -rf dist" },
      }),
    ).resolves.toEqual({ block: true, reason: "Destructive command blocked" });
  });

  test("blocks generated file edit paths before execution", async () => {
    const { handlers, calls } = registerWith([
      { ok: false, message: "Generated files must not be edited directly" },
    ]);

    await expect(
      handlers.tool_call({ toolName: "edit", toolCallId: "tool-2", input: { path: "AGENTS.md" } }),
    ).resolves.toEqual({ block: true, reason: "Generated files must not be edited directly" });

    expect(calls[0]?.payload).toMatchObject({
      hook: "pre-tool",
      eventId: "tool-2",
      toolName: "edit",
      edit: { paths: ["AGENTS.md"] },
    });
  });

  test("passes MultiEdit-style paths to the edit-path guard", async () => {
    const { handlers, calls } = registerWith([{ ok: true }]);

    await handlers.tool_call({
      toolName: "edit",
      toolCallId: "tool-3",
      input: {
        edits: [{ path: "src/a.ts" }, { filePath: "scripts/b.ts" }, { file_path: "src/c.ts" }],
      },
    });

    expect(calls[0]?.payload).toMatchObject({
      edit: { paths: ["src/a.ts", "scripts/b.ts", "src/c.ts"] },
    });
  });

  test("skips post-edit quality when the native tool already failed", async () => {
    const { handlers, calls } = registerWith([{ ok: false, message: "should not be used" }]);

    await expect(
      handlers.tool_result({
        toolName: "edit",
        toolCallId: "tool-4",
        input: { path: "src/a.ts" },
        isError: true,
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([]);
  });

  test("converts post-edit quality failures into Pi tool errors", async () => {
    const { handlers } = registerWith([{ ok: false, message: "Post-edit quality gate failed" }]);

    await expect(
      handlers.tool_result({
        toolName: "write",
        toolCallId: "tool-5",
        input: { path: "src/a.ts" },
        isError: false,
      }),
    ).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: "Post-edit quality gate failed" }],
    });
  });

  test("forwards post-edit warning context as replacement tool content", async () => {
    const { handlers } = registerWith([{ ok: true, context: "Formatted src/a.ts" }]);

    await expect(
      handlers.tool_result({
        toolName: "edit",
        toolCallId: "tool-6",
        input: { path: "src/a.ts" },
        isError: false,
      }),
    ).resolves.toEqual({ content: [{ type: "text", text: "Formatted src/a.ts" }] });
  });

  test("leaves successful post-edit quality silent when there is no context", async () => {
    const { handlers } = registerWith([{ ok: true }]);

    await expect(
      handlers.tool_result({
        toolName: "edit",
        toolCallId: "tool-7",
        input: { path: "src/a.ts" },
        isError: false,
      }),
    ).resolves.toBeUndefined();
  });

  test("reports stop validation failures through Pi notifications", async () => {
    const { handlers } = registerWith([{ ok: false, message: "Stop validation failed" }]);
    const notifications: unknown[] = [];

    await handlers.agent_end(undefined, {
      sessionManager: { getSessionFile: () => "session.jsonl" },
      ui: { notify: (message, level) => notifications.push({ message, level }) },
    });

    expect(notifications).toEqual([{ message: "Stop validation failed", level: "error" }]);
  });
});
