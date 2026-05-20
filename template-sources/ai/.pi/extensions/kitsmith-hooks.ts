// oxlint-disable typescript/consistent-return -- Pi event handlers intentionally return either hook decisions or undefined.
import { spawnSync } from "node:child_process";
import { cwd as processCwd } from "node:process";

const EDIT_TOOLS = new Set(["edit", "write"]);

// oxlint-disable-next-line import/no-default-export -- Pi discovers project extensions through default exports.
export default function kitsmithHooks(pi: ExtensionAPI): void {
  registerKitsmithHooks(pi, runHook);
}

export function registerKitsmithHooks(pi: ExtensionAPI, hookRunner: HookRunner): void {
  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash") {
      const result = hookRunner(".pi/hooks/guard-destructive.ts", piEvent(event, "pre-tool"));
      if (!result.ok) {
        return { block: true, reason: result.message };
      }
    }

    if (EDIT_TOOLS.has(event.toolName)) {
      const result = hookRunner(".pi/hooks/guard-edit-paths.ts", piEvent(event, "pre-tool"));
      if (!result.ok) {
        return { block: true, reason: result.message };
      }
    }

    return undefined;
  });

  pi.on("tool_result", async (event) => {
    if (!EDIT_TOOLS.has(event.toolName) || event.isError) {
      return undefined;
    }

    const result = hookRunner(".pi/hooks/post-edit-quality.ts", piEvent(event, "post-edit"));
    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: result.message }],
      };
    }

    if (result.context !== undefined) {
      return { content: [{ type: "text", text: result.context }] };
    }

    return undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const result = hookRunner(".pi/hooks/stop-validate.ts", {
      projectRoot: processCwd(),
      hook: "stop",
      ...(sessionFile === undefined ? {} : { runId: sessionFile }),
      edit: { paths: [] },
    });

    if (!result.ok) {
      console.error(result.message);
      ctx.ui.notify(result.message, "error");
    }

    return undefined;
  });
}

type HookRunner = (script: string, payload: PiHookPayload) => HookResult;

type ExtensionAPI = {
  on(
    event: "tool_call",
    handler: (
      event: PiToolEvent,
    ) => Promise<{ readonly block: true; readonly reason?: string } | undefined>,
  ): void;
  on(
    event: "tool_result",
    handler: (
      event: PiToolResultEvent,
    ) => Promise<
      { readonly content?: readonly ToolContent[]; readonly isError?: boolean } | undefined
    >,
  ): void;
  on(event: "agent_end", handler: (event: unknown, ctx: PiExtensionContext) => Promise<void>): void;
};

type PiExtensionContext = {
  readonly sessionManager: { readonly getSessionFile: () => string | undefined };
  readonly ui: { readonly notify: (message: string, level: "error" | "info" | "warning") => void };
};

type ToolContent = { readonly type: "text"; readonly text: string };

type PiToolEvent = {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input: unknown;
};

type PiToolResultEvent = PiToolEvent & {
  readonly isError: boolean;
};

type PiHookPayload = {
  readonly projectRoot: string;
  readonly hook: "pre-tool" | "post-edit" | "stop";
  readonly runId?: string;
  readonly eventId?: string;
  readonly toolName?: string;
  readonly command?: string;
  readonly edit: { readonly path?: string; readonly paths: readonly string[] };
};

type HookResult =
  | { readonly ok: true; readonly context?: string }
  | { readonly ok: false; readonly message: string };

function piEvent(event: PiToolEvent, hook: PiHookPayload["hook"]): PiHookPayload {
  const input = isRecord(event.input) ? event.input : {};
  const paths = touchedPaths(input);
  const command = stringValue(input["command"]);
  return {
    projectRoot: processCwd(),
    hook,
    eventId: event.toolCallId,
    toolName: event.toolName,
    ...(command === undefined ? {} : { command }),
    edit: { paths },
  };
}

function runHook(script: string, payload: PiHookPayload): HookResult {
  const child = spawnSync("bun", [script], {
    cwd: payload.projectRoot,
    input: JSON.stringify(payload),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (child.error !== undefined) {
    return { ok: false, message: `Pi hook failed to start: ${child.error.message}` };
  }

  const output = child.stdout.trim();
  if (output.length === 0) {
    return child.status === 0
      ? { ok: true }
      : { ok: false, message: child.stderr.trim() || `Pi hook exited ${child.status}` };
  }

  const lastLine = output.split(/\r?\n/).at(-1) ?? output;
  try {
    const parsed = JSON.parse(lastLine) as unknown;
    if (isRecord(parsed) && parsed["ok"] === false) {
      return {
        ok: false,
        message: stringValue(parsed["message"]) ?? "Pi hook blocked the action.",
      };
    }
    if (isRecord(parsed) && parsed["ok"] === true) {
      const context = stringValue(parsed["context"]);
      return context === undefined ? { ok: true } : { ok: true, context };
    }
  } catch {
    // Fall through to stderr/status handling.
  }

  return child.status === 0
    ? { ok: true }
    : { ok: false, message: child.stderr.trim() || output || `Pi hook exited ${child.status}` };
}

function touchedPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const path = stringValue(input["path"] ?? input["filePath"] ?? input["file_path"]);
  if (path !== undefined) {
    paths.push(path);
  }

  const edits = input["edits"];
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (!isRecord(edit)) {
        continue;
      }
      const editPath = stringValue(edit["path"] ?? edit["filePath"] ?? edit["file_path"]);
      if (editPath !== undefined) {
        paths.push(editPath);
      }
    }
  }

  return paths;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
