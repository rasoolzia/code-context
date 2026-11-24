import type { RouteEntry } from "./route-entry";

/**
 * Minimal filesystem abstraction used by scanners.
 * Keeping this separate from VS Code APIs makes scanners unit-testable
 * with plain in-memory implementations.
 */
export interface FilesystemReader {
  /** Returns the names of direct children of `directoryPath`, or `undefined` if the path does not exist or is not a directory. */
  readDirectory(
    directoryPath: string,
  ): Promise<{ name: string; isDirectory: boolean }[] | undefined>;
  /** Returns the text contents of a file, or `undefined` if it cannot be read. */
  readFile(filePath: string): Promise<string | undefined>;
  /** Returns `true` if the path exists as a file. */
  fileExists(filePath: string): Promise<boolean>;
}

export interface RouteScanner {
  /** Human-readable framework name shown in the UI and report. */
  readonly frameworkName: string;

  /**
   * Returns `true` when this scanner recognises the project rooted at
   * `workspaceRoot` as a project it can scan.
   */
  detect(workspaceRoot: string, fs: FilesystemReader): Promise<boolean>;

  /**
   * Scans the project and returns all discovered route entries sorted
   * deterministically.
   */
  scan(workspaceRoot: string, fs: FilesystemReader): Promise<RouteEntry[]>;
}
