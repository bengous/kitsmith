// Regex-matchable commands whose danger is expressible as a single literal
// shape. For anything with flag-order sensitivity (rm), we tokenise instead.
export const BLOCKED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/git\s+push\s+--force-with-lease\b/, "git push --force-with-lease"],
  [/git\s+push\s+--force(?!-)/, "git push --force"],
  [/git\s+push\s+-f\b/, "git push -f"],
  [/git\s+reset\s+--hard\b/, "git reset --hard"],
  [/git\s+clean\s+-f/, "git clean -f"],
  [/git\s+checkout\s+\.$/, "git checkout ."],
  [/git\s+checkout\s+--\s+\.$/, "git checkout -- ."],
  [/git\s+restore\s+\.$/, "git restore ."],
  [/git\s+branch\s+-D\b/, "git branch -D"],
  [/git\s+stash\s+drop\b/, "git stash drop"],
  [/git\s+stash\s+clear\b/, "git stash clear"],
];

export const MERGE_HINT =
  "git merge without --ff-only (use `git rebase` then `git merge --ff-only` for linear history)";

const SHELL_EXECUTORS = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);

export function stripStringLiterals(cmd: string): string {
  let stripped = cmd.replaceAll(/<<-?\s*'?(\w+)'?.*?\n[\s\S]*?\n\s*\1/g, "");
  stripped = stripped.replaceAll(/"(?:[^"\\]|\\.)*"/g, '""');
  stripped = stripped.replaceAll(/'[^']*'/g, "''");
  return stripped;
}

function shellWords(cmd: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of cmd) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) {
    current += "\\";
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
}

function tokenise(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

function executableName(token: string): string {
  const normalized = token.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function shellPayloads(cmd: string): string[] {
  const words = shellWords(cmd);
  const payloads: string[] = [];

  for (let index = 0; index < words.length - 1; index += 1) {
    const executable = words[index];
    const flags = words[index + 1];
    if (executable === undefined || flags === undefined) {
      continue;
    }
    if (!SHELL_EXECUTORS.has(executableName(executable))) {
      continue;
    }
    if (flags === "-c" || /^-[^-]*c/.test(flags)) {
      payloads.push(words[index + 2] ?? "");
    }
  }

  return payloads.filter((payload) => payload.trim().length > 0);
}

export function checkRm(tokens: readonly string[]): string | null {
  if (tokens[0] !== "rm") {
    return null;
  }

  let shortLetters = "";
  const longFlags = new Set<string>();
  const positional: string[] = [];
  for (const token of tokens.slice(1)) {
    if (token.startsWith("--")) {
      longFlags.add(token);
    } else if (/^-[a-zA-Z]+$/.test(token)) {
      shortLetters += token.slice(1);
    } else {
      positional.push(token);
    }
  }

  const recursive = /[rR]/.test(shortLetters) || longFlags.has("--recursive");
  const force = shortLetters.includes("f") || longFlags.has("--force");
  const absoluteTarget = positional.some((value) => value.startsWith("/"));

  if (recursive && force) {
    return "rm recursive + force";
  }
  if (recursive && absoluteTarget) {
    return "rm recursive on absolute path";
  }
  return null;
}

export function checkCommand(cmd: string): string | null {
  for (const payload of shellPayloads(cmd)) {
    const payloadMatch = checkCommand(payload) ?? checkMergeGuard(payload);
    if (payloadMatch !== null) {
      return payloadMatch;
    }
  }

  const sanitized = stripStringLiterals(cmd);
  const rmMatch = checkRm(tokenise(sanitized));
  if (rmMatch !== null) {
    return rmMatch;
  }
  for (const [pattern, label] of BLOCKED_PATTERNS) {
    if (pattern.test(sanitized)) {
      return label;
    }
  }
  return null;
}

export function checkMergeGuard(cmd: string): string | null {
  for (const payload of shellPayloads(cmd)) {
    const payloadMatch = checkMergeGuard(payload);
    if (payloadMatch !== null) {
      return payloadMatch;
    }
  }

  const sanitized = stripStringLiterals(cmd);
  if (!/git\s+merge\b/.test(sanitized)) {
    return null;
  }
  if (/--ff-only/.test(sanitized)) {
    return null;
  }
  return MERGE_HINT;
}
