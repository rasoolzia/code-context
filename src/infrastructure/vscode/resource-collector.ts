import * as vscode from "vscode";
import { getRelativePath } from "./vscode-file-reader";

const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  ".nuxt",
  "coverage",
]);

export async function collectResources(
  resources: readonly vscode.Uri[] = [],
): Promise<vscode.Uri[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    return [];
  }

  const roots =
    resources.length > 0
      ? resources
      : workspaceFolders.map((folder) => folder.uri);
  const files = new Map<string, vscode.Uri>();
  const visitedDirectories = new Set<string>();
  const failedResources: string[] = [];

  async function walkDirectory(directory: vscode.Uri): Promise<void> {
    const directoryKey = normalizeUri(directory);

    if (visitedDirectories.has(directoryKey)) {
      return;
    }

    visitedDirectories.add(directoryKey);

    let entries: [string, vscode.FileType][];

    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      failedResources.push(displayPath(directory));

      return;
    }

    for (const [name, type] of entries) {
      const child = vscode.Uri.joinPath(directory, name);

      if ((type & vscode.FileType.SymbolicLink) !== 0) {
        continue;
      }

      if ((type & vscode.FileType.Directory) !== 0) {
        if (!ignoredDirectories.has(name.toLowerCase())) {
          await walkDirectory(child);
        }
      } else if ((type & vscode.FileType.File) !== 0) {
        addFile(child);
      }
    }
  }

  function addFile(uri: vscode.Uri): void {
    if (!isIgnoredResource(uri)) {
      files.set(normalizeUri(uri), uri);
    }
  }

  function displayPath(uri: vscode.Uri): string {
    try {
      return getRelativePath(uri);
    } catch {
      return "a resource";
    }
  }

  for (const resource of roots) {
    if (
      !vscode.workspace.getWorkspaceFolder(resource) ||
      isIgnoredResource(resource)
    ) {
      continue;
    }

    let stat: vscode.FileStat;

    try {
      stat = await vscode.workspace.fs.stat(resource);
    } catch {
      failedResources.push(displayPath(resource));

      continue;
    }

    if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
      continue;
    }

    if ((stat.type & vscode.FileType.Directory) !== 0) {
      await walkDirectory(resource);
    } else if ((stat.type & vscode.FileType.File) !== 0) {
      addFile(resource);
    }
  }

  if (failedResources.length > 0) {
    const firstPath = failedResources[0];
    const remaining = failedResources.length - 1;
    const more = remaining > 0 ? ` and ${remaining} more` : "";

    await vscode.window.showWarningMessage(
      `Unable to inspect ${firstPath}${more}; some content may be missing.`,
    );
  }

  return [...files.values()].sort((left, right) =>
    compareText(getRelativePath(left), getRelativePath(right)),
  );
}

function normalizeUri(uri: vscode.Uri): string {
  const normalizedPath = uri.path.replace(/\/$/, "") || "/";

  return uri.with({ path: normalizedPath }).toString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isIgnoredResource(uri: vscode.Uri): boolean {
  const relativePath = vscode.workspace
    .asRelativePath(uri, false)
    .replace(/\\/g, "/");

  return relativePath
    .split("/")
    .some((segment) => ignoredDirectories.has(segment.toLowerCase()));
}
