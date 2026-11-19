import type { FilesystemEntry } from "../models/filesystem-entry";
import { normalizeFilesystemEntries } from "./filesystem-paths";

export function parsePathList(input: string): FilesystemEntry[] {
  const entries: FilesystemEntry[] = input
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => ({ path, type: "file" }));

  if (entries.length === 0) {
    throw new Error("Enter at least one file path.");
  }

  return normalizeFilesystemEntries(entries);
}
