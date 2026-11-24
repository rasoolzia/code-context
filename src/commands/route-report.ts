import * as vscode from "vscode";
import { generateRouteReport } from "../core/routes/route-report-generator";
import type { RouteScanner } from "../core/routes/route-scanner";
import { routeScanners } from "../core/routes/scanner-registry";
import { openExportDocument } from "../infrastructure/vscode/open-export-document";
import { vscodeFilesystemReader } from "../infrastructure/vscode/vscode-filesystem-reader";

export async function routeReport(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    await vscode.window.showWarningMessage(
      "Open a folder or workspace before generating a Route Report.",
    );

    return;
  }

  // Detect supported frameworks across all workspace folders.
  const candidates = await detectCandidates(workspaceFolders);

  if (candidates.length === 0) {
    await vscode.window.showWarningMessage(
      "No supported routing framework was detected in the workspace. " +
        "Route Report currently supports Next.js and Nuxt.",
    );

    return;
  }

  const chosen =
    candidates.length === 1
      ? candidates[0]
      : await pickCandidate(candidates);

  if (!chosen) {
    return;
  }

  const routes = await chosen.scanner.scan(
    chosen.workspaceRoot,
    vscodeFilesystemReader,
  );

  if (routes.length === 0) {
    await vscode.window.showWarningMessage(
      `No routes were found for ${chosen.scanner.frameworkName} in ${chosen.folderName}.`,
    );

    return;
  }

  const markdown = generateRouteReport(chosen.scanner.frameworkName, routes);

  await openExportDocument(markdown, "markdown");
}

// ── Detection ─────────────────────────────────────────────────────────────────

interface Candidate {
  scanner: RouteScanner;
  workspaceRoot: string;
  folderName: string;
}

async function detectCandidates(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  for (const folder of folders) {
    for (const scanner of routeScanners) {
      const detected = await scanner.detect(
        folder.uri.fsPath,
        vscodeFilesystemReader,
      );

      if (detected) {
        candidates.push({
          scanner,
          workspaceRoot: folder.uri.fsPath,
          folderName: folder.name,
        });
      }
    }
  }

  return candidates;
}

// ── Picker ────────────────────────────────────────────────────────────────────

async function pickCandidate(
  candidates: Candidate[],
): Promise<Candidate | undefined> {
  const items = candidates.map((candidate) => ({
    label: candidate.scanner.frameworkName,
    description: candidate.folderName,
    candidate,
  }));

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: "Multiple routing frameworks detected — choose one",
  });

  return selection?.candidate;
}
