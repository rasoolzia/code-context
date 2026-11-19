import * as vscode from "vscode";
import { generatePathList } from "../core/path-list-generator";
import { openExportDocument } from "../infrastructure/vscode/open-export-document";
import { collectResources } from "../infrastructure/vscode/resource-collector";
import { getRelativePath } from "../infrastructure/vscode/vscode-file-reader";

export async function exportPaths(...resources: vscode.Uri[]): Promise<void> {
  if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
    await vscode.window.showWarningMessage(
      "Open a folder or workspace before exporting file paths.",
    );

    return;
  }

  const files = await collectResources(resources);

  if (files.length === 0) {
    await vscode.window.showWarningMessage(
      "No valid files were found to export.",
    );

    return;
  }

  const content = generatePathList(files.map((uri) => getRelativePath(uri)));
  await openExportDocument(content, "plaintext");
}
