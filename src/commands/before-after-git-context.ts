import * as vscode from "vscode";
import {
  generateBeforeAfterGitContext,
  type GitFileContext,
} from "../core/git-context-generator";
import {
  collectChangedGitRepositories,
  getGitFileAtHead,
  getWorkingGitFile,
  GitCommandError,
  GitRepositoryNotFoundError,
} from "../infrastructure/git/git-client";
import { openExportDocument } from "../infrastructure/vscode/open-export-document";

export async function exportBeforeAfterGitContext(): Promise<void> {
  const workspacePaths =
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];

  if (workspacePaths.length === 0) {
    await vscode.window.showWarningMessage(
      "Open a workspace before exporting Before/After Git Context.",
    );
    return;
  }

  try {
    const repositories = await collectChangedGitRepositories(workspacePaths);
    const contexts: GitFileContext[] = [];

    for (const result of repositories) {
      for (const changedFile of result.files) {
        const beforePath = changedFile.oldPath ?? changedFile.path;
        const before = changedFile.untracked
          ? { content: "", binary: false, missing: true }
          : await getGitFileAtHead(result.repository, beforePath);
        const after = await getWorkingGitFile(
          result.repository,
          changedFile.path,
        );

        contexts.push({
          path: changedFile.path,
          oldPath: changedFile.oldPath,
          status: changedFile.status,
          before: before.content,
          after: after.content,
          beforeBinary: before.binary,
          afterBinary: after.binary,
        });
      }
    }

    if (contexts.length === 0) {
      await vscode.window.showInformationMessage(
        "No Git changes were found in the workspace.",
      );
      return;
    }

    await openExportDocument(
      generateBeforeAfterGitContext(contexts),
      "markdown",
    );
  } catch (error) {
    if (
      error instanceof GitRepositoryNotFoundError ||
      error instanceof GitCommandError
    ) {
      await vscode.window.showErrorMessage(error.message);
      return;
    }

    await vscode.window.showErrorMessage(
      error instanceof Error
        ? error.message
        : "Unable to export Before/After Git Context.",
    );
  }
}
