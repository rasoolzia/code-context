import * as vscode from "vscode";
import { exportBeforeAfterGitContext } from "./commands/before-after-git-context";
import { exportContent } from "./commands/export-content";
import { exportPaths } from "./commands/export-paths";
import { exportTree } from "./commands/export-tree";
import { generateContext } from "./commands/generate-context";
import { exportGitDiff } from "./commands/git-diff";
import { importContent } from "./commands/import-content";
import { importPaths } from "./commands/import-paths";
import { importProjectTree } from "./commands/import-project-tree";
import { routeReport } from "./commands/route-report";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.exportContent",
      async (resource: unknown, selectedResources: unknown) => {
        await exportContent(
          ...getCommandResources(resource, selectedResources),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.exportTree",
      async (resource: unknown, selectedResources: unknown) => {
        await exportTree(...getCommandResources(resource, selectedResources));
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.exportPaths",
      async (resource: unknown, selectedResources: unknown) => {
        await exportPaths(...getCommandResources(resource, selectedResources));
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.importContent",
      importContent,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.importTree",
      importProjectTree,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("code-context.importPaths", importPaths),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.gitDiff",
      async (resource: unknown, selectedResources: unknown) => {
        await exportGitDiff(
          ...getCommandResources(resource, selectedResources),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.generateContextFromPaths",
      generateContext,
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-context.beforeAfterGitContext",
      async (resource: unknown, selectedResources: unknown) => {
        await exportBeforeAfterGitContext(
          ...getCommandResources(resource, selectedResources),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("code-context.routeReport", routeReport),
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
