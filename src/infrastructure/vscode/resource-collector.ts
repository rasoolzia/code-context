import * as vscode from "vscode";
import type { ProjectTreeEntry } from "../../core/markdown/project-tree-generator";
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
  const entries = await collectEntries(resources);

  return entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.uri);
}

export async function collectProjectTree(
  resources: readonly vscode.Uri[] = [],
): Promise<ProjectTreeEntry[]> {
  const entries = await collectEntries(resources);

  if (resources.length === 0) {
    return entries.flatMap(({ uri, type }) => {
      const path = getWorkspaceRelativeTreePath(uri);

      return path || type === "file" ? [{ path, type }] : [];
    });
  }

  const entriesByUri = new Map(
    entries.map((entry) => [normalizeUri(entry.uri), entry]),
  );
  const selectedRootsByUri = new Map(
    resources.flatMap((uri) => {
      const entry = entriesByUri.get(normalizeUri(uri));

      return entry
        ? [
            [
              normalizeUri(uri),
              { ...entry, label: getResourceName(uri) },
            ] as const,
          ]
        : [];
    }),
  );
  const selectedRoots = [...selectedRootsByUri.values()];
  const rootLabels = getUniqueRootLabels(selectedRoots);

  return entries.map(({ uri, type }) => {
    const matchingRoots = selectedRoots
      .filter((root) =>
        root.type === "directory"
          ? isSameOrWithin(uri, root.uri)
          : normalizeUri(uri) === normalizeUri(root.uri),
      )
      .sort(
        (left, right) =>
          getUriDepth(left.uri) - getUriDepth(right.uri) ||
          compareText(getRelativePath(left.uri), getRelativePath(right.uri)),
      );
    const root = matchingRoots[0];

    if (!root) {
      return { path: getWorkspaceRelativeTreePath(uri), type };
    }

    const relativePath = getPathWithin(uri, root.uri);

    return {
      path: [rootLabels.get(normalizeUri(root.uri)), relativePath]
        .filter(Boolean)
        .join("/"),
      type,
    };
  });
}

function getWorkspaceRelativeTreePath(uri: vscode.Uri): string {
  const path = getRelativePath(uri).replace(/\\/g, "/");

  if (path === ".") {
    return "";
  }

  return path.endsWith("/.") ? path.slice(0, -2) : path;
}

function getUniqueRootLabels(
  roots: (CollectedEntry & { label: string })[],
): Map<string, string> {
  const labels = new Map<string, string>();
  const usedLabels = new Set<string>();
  const sortedRoots = [...roots].sort(
    (left, right) =>
      compareText(getRelativePath(left.uri), getRelativePath(right.uri)) ||
      compareText(left.type, right.type),
  );

  for (const root of sortedRoots) {
    let label = root.label;
    let suffix = 2;

    while (usedLabels.has(label)) {
      label = `${root.label}-${suffix}`;
      suffix += 1;
    }

    usedLabels.add(label);
    labels.set(normalizeUri(root.uri), label);
  }

  return labels;
}

function getResourceName(uri: vscode.Uri): string {
  const pathSegments = uri.path.split("/").filter(Boolean);
  const name = pathSegments[pathSegments.length - 1];

  if (name) {
    return name;
  }

  return vscode.workspace.getWorkspaceFolder(uri)?.name ?? "workspace";
}

function isSameOrWithin(uri: vscode.Uri, root: vscode.Uri): boolean {
  if (uri.scheme !== root.scheme || uri.authority !== root.authority) {
    return false;
  }

  const uriPath = normalizeUriPath(uri);
  const rootPath = normalizeUriPath(root);

  return (
    uriPath === rootPath ||
    uriPath.startsWith(rootPath === "/" ? "/" : `${rootPath}/`)
  );
}

function getPathWithin(uri: vscode.Uri, root: vscode.Uri): string {
  if (normalizeUri(uri) === normalizeUri(root)) {
    return "";
  }

  return uri.path
    .slice(normalizeUriPath(root).length)
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}

function getUriDepth(uri: vscode.Uri): number {
  return normalizeUriPath(uri).split("/").filter(Boolean).length;
}

function normalizeUriPath(uri: vscode.Uri): string {
  return uri.path.replace(/\/+$/, "") || "/";
}

async function collectEntries(
  resources: readonly vscode.Uri[],
): Promise<CollectedEntry[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    return [];
  }

  const roots =
    resources.length > 0
      ? resources
      : workspaceFolders.map((folder) => folder.uri);
  const entries = new Map<string, CollectedEntry>();
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
          addEntry(child, "directory");
          await walkDirectory(child);
        }
      } else if ((type & vscode.FileType.File) !== 0) {
        addEntry(child, "file");
      }
    }
  }

  function addEntry(uri: vscode.Uri, type: ProjectTreeEntry["type"]): void {
    if (!isIgnoredResource(uri)) {
      entries.set(normalizeUri(uri), { uri, type });
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
      addEntry(resource, "directory");
      await walkDirectory(resource);
    } else if ((stat.type & vscode.FileType.File) !== 0) {
      addEntry(resource, "file");
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

  return [...entries.values()].sort(
    (left, right) =>
      compareText(getRelativePath(left.uri), getRelativePath(right.uri)) ||
      compareText(left.type, right.type),
  );
}

interface CollectedEntry {
  uri: vscode.Uri;
  type: ProjectTreeEntry["type"];
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
