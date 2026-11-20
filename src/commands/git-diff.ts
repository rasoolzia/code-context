import * as vscode from "vscode";
import { generateGitDiffOutput } from "../core/git-context-generator";
import {
  collectChangedGitRepositories,
  getGitDiff,
  GitCommandError,
  GitRepositoryNotFoundError,
} from "../infrastructure/git/git-client";
import { openExportDocument } from "../infrastructure/vscode/open-export-document";

export async function exportGitDiff(): Promise<void> {
  const workspacePaths =
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];

  if (workspacePaths.length === 0) {
    await vscode.window.showWarningMessage(
      "Open a workspace before exporting Git Diff.",
    );
    return;
  }

  try {
    const repositories = await collectChangedGitRepositories(workspacePaths);
    const diffs: string[] = [];

    for (const result of repositories) {
      if (result.files.length > 0) {
        const diff = await getGitDiff(result.repository, result.files);

        if (diff) {
          diffs.push(diff);
        }
      }
    }

    if (diffs.length === 0) {
      await vscode.window.showInformationMessage(
        "No Git changes were found in the workspace.",
      );
      return;
    }

    await openExportDocument(
      generateGitDiffOutput(diffs.join("\n")),
      "plaintext",
    );
  } catch (error) {
    await showGitError(error);
  }
}

async function showGitError(error: unknown): Promise<void> {
  if (
    error instanceof GitRepositoryNotFoundError ||
    error instanceof GitCommandError
  ) {
    await vscode.window.showErrorMessage(error.message);
    return;
  }

  await vscode.window.showErrorMessage(
    error instanceof Error ? error.message : "Unable to export Git Diff.",
  );
}
