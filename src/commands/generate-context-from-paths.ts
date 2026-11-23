import * as vscode from "vscode";
import { validateWorkspacePath } from "../infrastructure/vscode/workspace-path-security";
import { exportContent } from "./export-content";
import { exportGitDiff } from "./git-diff";

export type GenerateOutput = "content" | "gitDiff";

export async function generateContextFromPaths(
  rawInput: string,
  output: GenerateOutput,
): Promise<boolean> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    throw new Error("Open a workspace folder before generating context.");
  }

  const workspaceFolder =
    workspaceFolders.length === 1
      ? workspaceFolders[0]
      : await chooseWorkspaceFolder();

  if (!workspaceFolder) {
    return false;
  }

  const uris = await resolvePathsToUris(rawInput, workspaceFolder, output);

  if (output === "content") {
    await exportContent(...uris);
  } else {
    await exportGitDiff(...uris);
  }

  return true;
}

export async function resolvePathsToUris(
  rawInput: string,
  workspaceFolder: vscode.WorkspaceFolder,
  output: GenerateOutput = "content",
): Promise<vscode.Uri[]> {
  const lines = rawInput
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("Enter at least one file path.");
  }

  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];

  for (const line of lines) {
    // validateWorkspacePath normalizes, checks traversal, rejects symlinks,
    // rejects directories at the final segment, and skips missing path
    // components (FileNotFound → continue). This covers all safety rules.
    const { uri } = await validateWorkspacePath(workspaceFolder, line, "file");
    const key = uri.path.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    // For Content, the file must exist in the working tree so it can be read.
    // For Git Diff, a missing file is valid (e.g. a deleted tracked file).
    if (output === "content") {
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (
          error instanceof vscode.FileSystemError &&
          error.code === "FileNotFound"
        ) {
          const normalized = line.replace(/\\/g, "/");
          throw new Error(`File not found: ${normalized}`);
        }

        throw error;
      }
    }

    uris.push(uri);
  }

  uris.sort((left, right) => {
    const leftPath = left.path.toLowerCase();
    const rightPath = right.path.toLowerCase();
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });

  return uris;
}

async function chooseWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  const selection = await vscode.window.showQuickPick(
    workspaceFolders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Choose the workspace folder containing the paths" },
  );

  return selection?.folder;
}
