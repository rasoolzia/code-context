import * as vscode from "vscode";
import type { FilesystemReader } from "../../core/routes/route-scanner";

/**
 * Implements `FilesystemReader` using the VS Code workspace filesystem API.
 * Symlinks are not followed (consistent with the rest of the extension).
 */
export const vscodeFilesystemReader: FilesystemReader = {
  async readDirectory(
    directoryPath: string,
  ): Promise<{ name: string; isDirectory: boolean }[] | undefined> {
    const uri = vscode.Uri.file(directoryPath);

    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return undefined;
    }

    return entries.flatMap(([name, type]) => {
      // Skip symlinks — consistent with resource-collector.ts
      if ((type & vscode.FileType.SymbolicLink) !== 0) {
        return [];
      }

      return [
        {
          name,
          isDirectory: (type & vscode.FileType.Directory) !== 0,
        },
      ];
    });
  },

  async readFile(filePath: string): Promise<string | undefined> {
    try {
      const contents = await vscode.workspace.fs.readFile(
        vscode.Uri.file(filePath),
      );

      return new TextDecoder().decode(contents);
    } catch {
      return undefined;
    }
  },

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

      return (
        (stat.type & vscode.FileType.SymbolicLink) === 0 &&
        (stat.type & vscode.FileType.File) !== 0
      );
    } catch {
      return false;
    }
  },
};
