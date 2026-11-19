import * as vscode from "vscode";
import { generateMarkdown } from "../core/markdown/markdown-generator";
import { openExportDocument } from "../infrastructure/vscode/open-export-document";
import { collectResources } from "../infrastructure/vscode/resource-collector";
import {
  getRelativePath,
  readContextFile,
} from "../infrastructure/vscode/vscode-file-reader";

export async function exportContent(...resources: vscode.Uri[]): Promise<void> {
  if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
    await vscode.window.showWarningMessage(
      "Open a folder or workspace before exporting content.",
    );

    return;
  }

  const collectedResources = await collectResources(resources);

  if (collectedResources.length === 0) {
    await vscode.window.showWarningMessage(
      "No valid files or folders were found to export.",
    );

    return;
  }

  const results = await Promise.allSettled(
    collectedResources.map((uri) => readContextFile(uri)),
  );
  const files = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedPaths = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [getRelativePath(collectedResources[index])]
      : [],
  );

  if (failedPaths.length > 0) {
    const remaining = failedPaths.length - 1;
    const more = remaining > 0 ? ` and ${remaining} more` : "";

    await vscode.window.showWarningMessage(
      `Unable to read ${failedPaths[0]}${more}; continuing with the remaining files.`,
    );
  }

  if (files.length === 0) {
    await vscode.window.showWarningMessage(
      "None of the selected files could be read.",
    );

    return;
  }

  const markdown = generateMarkdown(files);
  await openExportDocument(markdown, "markdown");
}
