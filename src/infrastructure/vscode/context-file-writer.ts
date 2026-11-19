import * as vscode from "vscode";
import type { ContextFile } from "../../core/models/context-file";
import { validateWorkspacePath } from "./workspace-path-security";

export async function writeContextFiles(
  workspaceFolder: vscode.WorkspaceFolder,
  files: readonly ContextFile[],
): Promise<void> {
  const targets: {
    file: ContextFile;
    path: string;
    uri: vscode.Uri;
  }[] = [];

  for (const file of files) {
    const target = await validateWorkspacePath(
      workspaceFolder,
      file.path,
      "file",
    );
    targets.push({ file, ...target });
  }

  for (const { file, uri, path } of targets) {
    try {
      const segments = path.split("/");
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
