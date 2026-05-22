import type { AgentHookEvent } from "./contract.ts";

export class MissingSessionIdError extends Error {
  constructor() {
    super("Hook payload is missing session_id. Kitsmith hooks require session-scoped state.");
    this.name = "MissingSessionIdError";
  }
}

export function requireSessionId(input: AgentHookEvent): string {
  const sessionId = input.sessionId?.trim();
  if (sessionId !== undefined && sessionId.length > 0) {
    return sessionId;
  }

  throw new MissingSessionIdError();
}
