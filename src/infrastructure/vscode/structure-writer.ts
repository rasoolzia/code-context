import * as vscode from "vscode";
import type { FilesystemEntry } from "../../core/models/filesystem-entry";
import { normalizeFilesystemEntries } from "../../core/paths/filesystem-paths";
import { validateWorkspacePath } from "./workspace-path-security";

export async function createFilesystemStructure(
  workspaceFolder: vscode.WorkspaceFolder,
  entries: readonly FilesystemEntry[],
): Promise<void> {
  const normalizedEntries = normalizeFilesystemEntries(entries);
  const targets: { entry: FilesystemEntry; path: string; uri: vscode.Uri }[] =
    [];

  for (const entry of normalizedEntries) {
    const target = await validateWorkspacePath(
      workspaceFolder,
      entry.path,
      entry.type,
    );
    targets.push({ entry, ...target });
  }

  const directories = new Map<string, string>();

  for (const { entry, path } of targets) {
    const segments = path.split("/");

    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/");
      directories.set(parent.toLowerCase(), parent);
    }

    if (entry.type === "directory") {
      directories.set(path.toLowerCase(), path);
    }
  }

  const sortedDirectories = [...directories.values()].sort(
    (left, right) =>
      getDepth(left) - getDepth(right) || compareText(left, right),
  );

  for (const path of sortedDirectories) {
    try {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(workspaceFolder.uri, ...path.split("/")),
      );
    } catch {
      throw new Error(`Unable to create directory ${path}.`);
    }
  }

  for (const { entry, uri, path } of targets) {
    if (entry.type !== "file") {
      continue;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);

      if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
        throw new Error(`The path traverses a symbolic link: ${path}`);
      }

      if ((stat.type & vscode.FileType.Directory) !== 0) {
        throw new Error(`A directory exists at the file path: ${path}`);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error instanceof Error
          ? error
          : new Error(`Unable to inspect ${path}.`);
      }

      try {
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      } catch {
        throw new Error(`Unable to create empty file ${path}.`);
      }
    }
  }
}

function getDepth(path: string): number {
  return path.split("/").length;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}
