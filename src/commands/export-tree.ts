import * as vscode from "vscode";
import { generateProjectTree } from "../core/markdown/project-tree-generator";
import { openExportDocument } from "../infrastructure/vscode/open-export-document";
import { collectProjectTree } from "../infrastructure/vscode/resource-collector";

export async function exportTree(...resources: vscode.Uri[]): Promise<void> {
  if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
    await vscode.window.showWarningMessage(
      "Open a folder or workspace before exporting the project tree.",
    );

    return;
  }

  const entries = await collectProjectTree(resources);

  if (entries.length === 0) {
    await vscode.window.showWarningMessage(
      "No valid files or folders were found to export.",
    );

    return;
  }

  await openExportDocument(generateProjectTree(entries), "markdown");
}
