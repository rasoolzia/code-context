import * as vscode from "vscode";
import type { ContextFile } from "../../core/models/context-file";

export async function writeContextFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  files: readonly ContextFile[],
): Promise<void> {
  const targets = files.map((file) => ({
    file,
    uri: vscode.Uri.joinPath(workspaceFolder.uri, ...file.path.split("/")),
  }));

  for (const target of targets) {
    if (!isWithinWorkspace(target.uri, workspaceFolder.uri)) {
      throw new Error(
        `The file path is outside the workspace: ${target.file.path}`,
      );
    }

    await validateDestination(workspaceFolder.uri, target.file);
  }

  for (const { file, uri } of targets) {
    try {
      const segments = file.path.split("/");
      const parent = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ...segments.slice(0, -1),
      );
      await vscode.workspace.fs.createDirectory(parent);
      await vscode.workspace.fs.writeFile(
        uri,
        new TextEncoder().encode(file.content),
      );
    } catch {
      throw new Error(
        `Unable to write ${file.path}. Check workspace permissions.`,
      );
    }
  }
}

async function validateDestination(
  workspaceRoot: vscode.Uri,
  file: ContextFile,
): Promise<void> {
  const segments = file.path.split("/");
  let current = workspaceRoot;

  for (const [index, segment] of segments.entries()) {
    current = vscode.Uri.joinPath(current, segment);

    let stat: vscode.FileStat;

    try {
      stat = await vscode.workspace.fs.stat(current);
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }

      throw new Error(`Unable to inspect ${file.path} inside the workspace.`);
    }

    if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
      throw new Error(`The file path traverses a symbolic link: ${file.path}`);
    }

    const isFileName = index === segments.length - 1;

    if (isFileName && (stat.type & vscode.FileType.Directory) !== 0) {
      throw new Error(
        `A directory already exists at the file path: ${file.path}`,
      );
    }

    if (!isFileName && (stat.type & vscode.FileType.Directory) === 0) {
      throw new Error(`A parent path is not a directory: ${file.path}`);
    }
  }
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
