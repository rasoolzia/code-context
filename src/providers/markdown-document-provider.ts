import * as vscode from "vscode";

export class MarkdownDocumentProvider
  implements vscode.TextDocumentContentProvider
{
  private readonly documents = new Map<string, string>();

  setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? "";
  }
}
