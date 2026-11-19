import * as vscode from "vscode";

export async function openExportDocument(
  content: string,
  language: "markdown" | "plaintext",
): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language,
    content,
  });

  await vscode.window.showTextDocument(document, { preview: false });
}
