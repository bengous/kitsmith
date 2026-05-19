import path from "node:path";

function usesWindowsSemantics(...paths: readonly string[]): boolean {
  return paths.some((value) => /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\"));
}

export function toPosixSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

export function repoRelativePath(
  filePath: string,
  projectRoot = process.cwd(),
  cwd = projectRoot,
): string | null {
  const pathApi = usesWindowsSemantics(filePath, projectRoot, cwd) ? path.win32 : path;
  const root = pathApi.resolve(projectRoot);
  const absolute = pathApi.isAbsolute(filePath)
    ? pathApi.resolve(filePath)
    : pathApi.resolve(cwd, filePath);
  const relative = pathApi.relative(root, absolute);

  if (relative === "" || relative.startsWith("..") || pathApi.isAbsolute(relative)) {
    return null;
  }

  return toPosixSeparators(relative).replace(/^\.\//, "");
}
