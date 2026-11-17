import * as vscode from "vscode";
import { generateProjectTree } from "../core/markdown/project-tree-generator";
import { collectProjectTree } from "../infrastructure/vscode/resource-collector";
import { MarkdownDocumentProvider } from "../providers/markdown-document-provider";

export async function exportTree(
  provider: MarkdownDocumentProvider,
  ...resources: vscode.Uri[]
): Promise<void> {
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

  const documentUri = vscode.Uri.parse(
    `code-context:tree-${Date.now()}-${nextDocumentId++}.md`,
  );
  provider.setContent(documentUri, generateProjectTree(entries));

  const document = await vscode.workspace.openTextDocument(documentUri);

  await vscode.window.showTextDocument(document, { preview: false });
}

let nextDocumentId = 0;
