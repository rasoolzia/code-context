import * as vscode from "vscode";
import { exportContent } from "./commands/export-content";
import { MarkdownDocumentProvider } from "./providers/markdown-document-provider";

export function activate(context: vscode.ExtensionContext): void {
  const markdownProvider = new MarkdownDocumentProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "code-context",
      markdownProvider,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.exportContent",
      async (resource: unknown, selectedResources: unknown) => {
        const selectedUris = Array.isArray(selectedResources)
          ? selectedResources.filter(
              (value): value is vscode.Uri => value instanceof vscode.Uri,
            )
          : [];
        const uris =
          selectedUris.length > 0
            ? selectedUris
            : resource instanceof vscode.Uri
              ? [resource]
              : [];

        const validUris = uris.filter(
          (value): value is vscode.Uri => value instanceof vscode.Uri,
        );

        await exportContent(markdownProvider, ...validUris);
      },
    ),
  );
}

export function deactivate(): void {}
