import type { CommandRunner, AgentFeedbackResult, AgentHookEvent } from "./contract.ts";
import { defaultRunCommand, commandOutput, repoRoot, tail } from "./command-runner.ts";
import { forbiddenTouchedPaths, generatedPathMessage } from "./generated-files.ts";
import { clearTouchedPaths, readTouchedPaths } from "./touched-paths.ts";

export async function runStopValidation(
  input: AgentHookEvent,
  runner: CommandRunner = defaultRunCommand,
): Promise<AgentFeedbackResult> {
  if (input.stopHookActive === true) {
    return {};
  }

  const root = repoRoot(input.cwd);
  const forbidden = forbiddenTouchedPaths(await readTouchedPaths(input), root);
  if (forbidden.length > 0) {
    return { blockReason: generatedPathMessage(forbidden) };
  }

  const result = await runner(["bun", "scripts/validation/validate-on-stop.ts"], { cwd: root });
  if (result.code !== 0) {
    return {
      blockReason: `Stop validation failed:\n${tail(commandOutput(result), 80)}`,
    };
  }

  await clearTouchedPaths(input);
  return {};
}
