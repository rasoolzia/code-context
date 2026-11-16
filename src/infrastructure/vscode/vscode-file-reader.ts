import * as vscode from "vscode";
import type { ContextFile } from "../../core/models/context-file";

let cachedWorkspaceFolderSignature: string | undefined;
let cachedWorkspaceFolderNames = new Map<string, string>();

export function getRelativePath(uri: vscode.Uri): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

  if (!workspaceFolder) {
    throw new Error("The resource is not inside an open workspace.");
  }

  const relativePath = vscode.workspace
    .asRelativePath(uri, false)
    .replace(/\\/g, "/");
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length < 2) {
    return relativePath;
  }

  const folderNames = getWorkspaceFolderNames(workspaceFolders);

  return `${folderNames.get(workspaceFolder.uri.toString())}/${relativePath}`;
}

function getWorkspaceFolderNames(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
): Map<string, string> {
  const sortedFolders = [...workspaceFolders].sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.uri.toString(), right.uri.toString()),
  );
  const signature = JSON.stringify(
    sortedFolders.map((folder) => [folder.uri.toString(), folder.name]),
  );

  if (signature === cachedWorkspaceFolderSignature) {
    return cachedWorkspaceFolderNames;
  }

  const folderNames = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const folder of sortedFolders) {
    const baseName = folder.name.replace(/[\\/]/g, "_") || "workspace";
    let name = baseName;
    let suffix = 2;

    while (usedNames.has(name)) {
      name = `${baseName}-${suffix}`;
      suffix += 1;
    }

    usedNames.add(name);
    folderNames.set(folder.uri.toString(), name);
  }

  cachedWorkspaceFolderSignature = signature;
  cachedWorkspaceFolderNames = folderNames;

  return folderNames;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function readContextFile(uri: vscode.Uri): Promise<ContextFile> {
  const path = getRelativePath(uri);
  const document = await vscode.workspace.openTextDocument(uri);

  return {
    path,
    language: document.languageId,
    content: document.getText(),
  };
}
