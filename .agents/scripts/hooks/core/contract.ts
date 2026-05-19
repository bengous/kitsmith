export type AgentId = string;

export type AgentHookKind = "pre-tool" | "post-edit" | "stop";

// Canonical event consumed by the shared hook core. Native protocol fields
// such as stop_hook_active, tool_input, or tool_response belong in adapters.
export type AgentHookEvent = {
  readonly agent: AgentId;
  readonly hook: AgentHookKind;
  readonly sessionId?: string;
  readonly toolCallId?: string;
  readonly transcriptPath?: string;
  readonly toolName?: string;
  readonly cwd?: string;
  readonly stopHookActive?: boolean;
  readonly touchedPathCandidates: readonly string[];
  readonly patchText?: string;
  readonly toolCommand?: string;
  readonly nativeToolResponse?: unknown;
};

export type CommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type CommandRunner = (
  command: readonly string[],
  options: { readonly cwd: string },
) => Promise<CommandResult>;

export type UpdatedFileSnapshot = {
  readonly path: string;
  readonly before: string;
  readonly after: string;
};

export type AgentFeedbackResult = {
  readonly blockReason?: string;
  readonly systemMessage?: string;
  readonly updatedFile?: UpdatedFileSnapshot;
};

export type AgentCapabilities = {
  readonly updatedToolOutput: boolean;
};

// Adapter boundary between native harness payloads and the shared hook core.
export type AgentAdapter = {
  readonly agent: AgentId;
  readonly capabilities: AgentCapabilities;
  readonly readEvent: (hook: AgentHookKind) => Promise<AgentHookEvent>;
  readonly printPostEditResult: (result: AgentFeedbackResult, event: AgentHookEvent) => void;
  readonly printStopResult: (result: AgentFeedbackResult) => void;
  readonly printPreToolDeny: (reason: string) => void;
};
