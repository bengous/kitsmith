import type {
  CommandRunner,
  CommandResult,
  AgentFeedbackResult,
  AgentHookEvent,
} from "./contract.ts";
import { randomUUID } from "node:crypto";
import { defaultRunCommand, commandOutput, repoRoot, tail } from "./command-runner.ts";
import { forbiddenTouchedPaths, generatedPathMessage } from "./generated-files.ts";
import { requireSessionId } from "./session.ts";
import { clearTouchedPaths, pruneStaleTouchedState, readTouchedPaths } from "./touched-paths.ts";

const STOP_VALIDATION_PROTOCOL = "kitsmith.stop-validation";
const STOP_VALIDATION_PROTOCOL_VERSION = 1;

type StopValidationProtocolRecord = {
  readonly protocol: typeof STOP_VALIDATION_PROTOCOL;
  readonly version: typeof STOP_VALIDATION_PROTOCOL_VERSION;
  readonly type: "failure";
  readonly runId: string;
  readonly failureKind: "validation_failed" | "unclassified_stop_step";
  readonly step?: string;
  readonly exitCode?: number;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
  readonly stdoutRef?: string;
  readonly stderrRef?: string;
  readonly actionHint?: string;
};

type ProtocolParseResult =
  | { readonly ok: true; readonly records: readonly StopValidationProtocolRecord[] }
  | { readonly ok: false; readonly reason: string };

export async function runStopValidation(
  input: AgentHookEvent,
  runner: CommandRunner = defaultRunCommand,
): Promise<AgentFeedbackResult> {
  if (input.stopHookActive === true) {
    return {};
  }

  const sessionId = requireSessionId(input);
  const root = repoRoot(input.cwd);
  await pruneStaleTouchedState(input);
  const touchedPaths = await readTouchedPaths(input);
  const forbidden = forbiddenTouchedPaths(touchedPaths, root);
  if (forbidden.length > 0) {
    return { blockReason: generatedPathMessage(forbidden) };
  }

  if (touchedPaths.length === 0) {
    await clearTouchedPaths(input);
    return {};
  }

  const runId = randomUUID();
  const result = await runner(["bun", "scripts/validation/validate-on-stop.ts"], {
    cwd: root,
    env: {
      KITSMITH_STOP_RUN_ID: runId,
      KITSMITH_STOP_SESSION_ID: sessionId,
      KITSMITH_STOP_CHANGED_FILES_JSON: JSON.stringify(touchedPaths),
    },
  });

  const protocol = parseValidationProtocol(result.stdout, runId);
  if (!protocol.ok) {
    return { blockReason: invalidProtocolMessage(result, protocol.reason) };
  }

  const [record] = protocol.records;
  if (record !== undefined) {
    return { blockReason: validationProtocolMessage(record) };
  }

  if (result.code !== 0) {
    return {
      blockReason: invalidProtocolMessage(
        result,
        "Validation exited non-zero without JSONL records.",
      ),
    };
  }

  await clearTouchedPaths(input);
  return {};
}

function parseValidationProtocol(stdout: string, runId: string): ProtocolParseResult {
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const records: StopValidationProtocolRecord[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false, reason: "Validation stdout contained non-JSONL output." };
    }

    if (!isStopValidationProtocolRecord(parsed)) {
      return { ok: false, reason: "Validation stdout contained an unknown protocol record." };
    }
    if (parsed.runId !== runId) {
      return { ok: false, reason: "Validation protocol runId was missing or mismatched." };
    }
    records.push(parsed);
  }

  return { ok: true, records };
}

function isStopValidationProtocolRecord(value: unknown): value is StopValidationProtocolRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    objectProperty(value, "protocol") === STOP_VALIDATION_PROTOCOL &&
    objectProperty(value, "version") === STOP_VALIDATION_PROTOCOL_VERSION &&
    objectProperty(value, "type") === "failure" &&
    typeof objectProperty(value, "runId") === "string" &&
    (objectProperty(value, "failureKind") === "validation_failed" ||
      objectProperty(value, "failureKind") === "unclassified_stop_step") &&
    optionalString(objectProperty(value, "step")) &&
    optionalNumber(objectProperty(value, "exitCode")) &&
    optionalString(objectProperty(value, "stdoutTail")) &&
    optionalString(objectProperty(value, "stderrTail")) &&
    optionalString(objectProperty(value, "stdoutRef")) &&
    optionalString(objectProperty(value, "stderrRef")) &&
    optionalString(objectProperty(value, "actionHint"))
  );
}

function objectProperty(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function validationProtocolMessage(record: StopValidationProtocolRecord): string {
  if (record.failureKind === "unclassified_stop_step") {
    return [
      `Stop validation refused unclassified step${record.step ? `: ${record.step}` : "."}`,
      record.actionHint ?? "Classify the Stop step as read-only before running it during Stop.",
    ].join("\n");
  }

  const details = [
    `Stop validation failed${record.step ? ` in ${record.step}` : ""}${
      record.exitCode === undefined ? "." : ` with exit code ${record.exitCode}.`
    }`,
    record.stdoutRef ? `stdout: ${record.stdoutRef}` : undefined,
    record.stderrRef ? `stderr: ${record.stderrRef}` : undefined,
    !record.stderrRef && record.stderrTail ? `stderr tail:\n${record.stderrTail}` : undefined,
    !record.stdoutRef && record.stdoutTail ? `stdout tail:\n${record.stdoutTail}` : undefined,
    record.actionHint,
  ].filter((line): line is string => line !== undefined && line.length > 0);
  return details.join("\n");
}

function invalidProtocolMessage(result: CommandResult, reason: string): string {
  const excerpt = tail(commandOutput(result), 20);
  return [
    "Stop validation produced an invalid validation protocol.",
    reason,
    excerpt ? `Raw output excerpt:\n${excerpt}` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
