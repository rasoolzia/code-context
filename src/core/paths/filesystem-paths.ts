import type { FilesystemEntry } from "../models/filesystem-entry";

export function normalizeSafeRelativePath(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");

  if (
    normalizedPath.length === 0 ||
    normalizedPath.includes("\0") ||
    normalizedPath.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalizedPath)
  ) {
    throw new Error("The path must be relative to the workspace.");
  }

  const segments = normalizedPath.split("/");

  if (segments.some((segment) => segment === "..")) {
    throw new Error("The path cannot escape the workspace.");
  }

  const safeSegments = segments.filter(
    (segment) => segment !== "" && segment !== ".",
  );

  if (safeSegments.length === 0) {
    throw new Error("The path is empty.");
  }

  return safeSegments.join("/");
}

export function normalizeFilesystemEntries(
  entries: readonly FilesystemEntry[],
): FilesystemEntry[] {
  const normalizedEntries = new Map<string, FilesystemEntry>();

  for (const entry of entries) {
    const path = normalizeSafeRelativePath(entry.path);
    const key = path.toLowerCase();
    const existing = normalizedEntries.get(key);

    if (existing && existing.type !== entry.type) {
      throw new Error(`The path is both a file and a directory: ${path}`);
    }

    if (!existing) {
      normalizedEntries.set(key, { path, type: entry.type });
    }
  }

  const values = [...normalizedEntries.values()];
  const filePaths = new Set(
    values
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.path.toLowerCase()),
  );

  for (const entry of values) {
    const segments = entry.path.split("/");

    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/").toLowerCase();

      if (filePaths.has(ancestor)) {
        throw new Error(
          `A file cannot also be a parent directory: ${segments.slice(0, index).join("/")}`,
        );
      }
    }
  }

  return values.sort((left, right) => compareText(left.path, right.path));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
