export function generatePathList(paths: readonly string[]): string {
  const normalizedPaths = [
    ...new Set(paths.map((path) => path.replace(/\\/g, "/"))),
  ];

  return normalizedPaths.sort(compareText).join("\n");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
