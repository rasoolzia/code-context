import * as vscode from "vscode";
import type { FilesystemEntry } from "../../core/models/filesystem-entry";
import { normalizeSafeRelativePath } from "../../core/paths/filesystem-paths";

export async function validateWorkspacePath(
  workspaceFolder: vscode.WorkspaceFolder,
  path: string,
  type: FilesystemEntry["type"],
): Promise<{ path: string; uri: vscode.Uri }> {
  const normalizedPath = normalizeSafeRelativePath(path);
  const segments = normalizedPath.split("/");
  const uri = vscode.Uri.joinPath(workspaceFolder.uri, ...segments);

  if (!isWithinWorkspace(uri, workspaceFolder.uri)) {
    throw new Error(`The path is outside the workspace: ${normalizedPath}`);
  }

  let current = workspaceFolder.uri;

  for (const [index, segment] of segments.entries()) {
    current = vscode.Uri.joinPath(current, segment);

    let stat: vscode.FileStat;

    try {
      stat = await vscode.workspace.fs.stat(current);
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }

      throw new Error(
        `Unable to inspect ${normalizedPath} inside the workspace.`,
      );
    }

    if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
      throw new Error(`The path traverses a symbolic link: ${normalizedPath}`);
    }

    const isFinalSegment = index === segments.length - 1;
    const expectedType = isFinalSegment ? type : "directory";

    if (
      expectedType === "directory" &&
      (stat.type & vscode.FileType.Directory) === 0
    ) {
      throw new Error(`A parent path is not a directory: ${normalizedPath}`);
    }

    if (
      expectedType === "file" &&
      (stat.type & vscode.FileType.Directory) !== 0
    ) {
      throw new Error(`A directory exists at the file path: ${normalizedPath}`);
    }
  }

  return { path: normalizedPath, uri };
}

function isWithinWorkspace(uri: vscode.Uri, root: vscode.Uri): boolean {
  if (uri.scheme !== root.scheme || uri.authority !== root.authority) {
    return false;
  }

  const rootPath = root.path.replace(/\/+$/, "") || "/";
  const targetPath = uri.path.replace(/\/+$/, "") || "/";

  return (
    targetPath === rootPath ||
    targetPath.startsWith(rootPath === "/" ? "/" : `${rootPath}/`)
  );
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}
