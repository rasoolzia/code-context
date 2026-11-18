import * as vscode from "vscode";
import { exportContent } from "./commands/export-content";
import { exportTree } from "./commands/export-tree";
import { importContent } from "./commands/import-content";
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
        await exportContent(
          markdownProvider,
          ...getCommandResources(resource, selectedResources),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.exportTree",
      async (resource: unknown, selectedResources: unknown) => {
        await exportTree(
          markdownProvider,
          ...getCommandResources(resource, selectedResources),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.importContent",
      importContent,
    ),
  );
}

export function deactivate(): void {}

function getCommandResources(
  resource: unknown,
  selectedResources: unknown,
): vscode.Uri[] {
  const selectedUris = Array.isArray(selectedResources)
    ? selectedResources.filter(
        (value): value is vscode.Uri => value instanceof vscode.Uri,
      )
    : [];

  if (selectedUris.length > 0) {
    return selectedUris;
  }

  return resource instanceof vscode.Uri ? [resource] : [];
}
