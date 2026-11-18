import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { parseMarkdownContent } from "../core/markdown/markdown-parser";
import type { ContextFile } from "../core/models/context-file";
import { writeContextFiles } from "../infrastructure/vscode/context-file-writer";

interface ImportPanelMessage {
  type: "import" | "close";
  markdown?: string;
}

export function importContent(): void {
  const panel = vscode.window.createWebviewPanel(
    "codeContextImport",
    "CodeContext: Import Content",
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [] },
  );
  const nonce = randomBytes(18).toString("base64");
  panel.webview.html = getImportPanelHtml(nonce);

  let isImporting = false;
  panel.webview.onDidReceiveMessage(async (message: ImportPanelMessage) => {
    if (message.type === "close") {
      panel.dispose();
      return;
    }

    if (message.type !== "import" || isImporting) {
      return;
    }

    isImporting = true;

    try {
      await panel.webview.postMessage({ type: "working" });
      await importMarkdown(panel, message.markdown ?? "");
    } catch (error) {
      postStatus(
        panel,
        "import-error",
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while importing.",
      );
    } finally {
      isImporting = false;
    }
  });
}

async function importMarkdown(
  panel: vscode.WebviewPanel,
  markdown: string,
): Promise<void> {
  let files: ContextFile[];

  try {
    files = parseMarkdownContent(markdown);
  } catch (error) {
    postStatus(
      panel,
      "validation-error",
      error instanceof Error ? error.message : "The Markdown is invalid.",
    );
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    postStatus(panel, "validation-error", "Open a workspace folder before importing.");
    return;
  }

  let workspaceFolder = workspaceFolders[0];

  if (workspaceFolders.length > 1) {
    const selection = await vscode.window.showQuickPick(
      workspaceFolders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      })),
      { placeHolder: "Choose the workspace folder for imported files" },
    );

    if (!selection) {
      postStatus(panel, "cancelled", "Import cancelled. No files were changed.");
      return;
    }

    workspaceFolder = selection.folder;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Import ${files.length} file${files.length === 1 ? "" : "s"} into ${workspaceFolder.name}? Existing files will be overwritten.`,
    { modal: true },
    "Import",
  );

  if (confirmation !== "Import") {
    postStatus(panel, "cancelled", "Import cancelled. No files were changed.");
    return;
  }

  try {
    await writeContextFiles(workspaceFolder, files);
  } catch (error) {
    postStatus(
      panel,
      "import-error",
      error instanceof Error ? error.message : "An unknown error occurred while writing files.",
    );
    return;
  }

  postStatus(
    panel,
    "success",
    `Imported ${files.length} file${files.length === 1 ? "" : "s"} into ${workspaceFolder.name}.`,
  );
}

function postStatus(
  panel: vscode.WebviewPanel,
  type: "validation-error" | "import-error" | "cancelled" | "success",
  message: string,
): void {
  void panel.webview.postMessage({ type, message });
}

function getImportPanelHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>CodeContext Import Content</title>
  <style>
    :root { color-scheme: light dark; }
    body { padding: 0 18px 18px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    main { max-width: 1100px; margin: 0 auto; }
    h1 { font-size: 1.35rem; margin: 18px 0 8px; }
    p { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
    label { display: block; margin-bottom: 8px; }
    textarea { box-sizing: border-box; display: block; width: 100%; min-height: 55vh; max-height: 72vh; resize: vertical; padding: 12px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); font: var(--vscode-editor-font-weight) var(--vscode-editor-font-size)/1.5 var(--vscode-editor-font-family); }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    button { padding: 6px 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled { opacity: 0.65; cursor: default; }
    #status { min-height: 1.5em; margin-top: 12px; color: var(--vscode-errorForeground); white-space: pre-wrap; }
    #status[data-state="success"], #status[data-state="cancelled"] { color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <main>
    <h1>Import Content</h1>
    <p>Paste a complete CodeContext Markdown export below.</p>
    <label for="markdown">CodeContext Markdown</label>
    <textarea id="markdown" spellcheck="false" aria-label="CodeContext Markdown" placeholder="# Code Context&#10;&#10;## Files&#10;&#10;### src/example.ts&#10;&#10;&#96;&#96;&#96;typescript&#10;Paste the complete export here&#10;&#96;&#96;&#96;"></textarea>
    <div class="actions">
      <button id="import" type="button">Import</button>
      <button id="close" class="secondary" type="button">Cancel / Close</button>
    </div>
    <div id="status" role="status" aria-live="polite"></div>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const markdown = document.getElementById('markdown');
    const importButton = document.getElementById('import');
    const closeButton = document.getElementById('close');
    const status = document.getElementById('status');
    importButton.addEventListener('click', () => {
      status.dataset.state = 'working';
      status.textContent = 'Validating Markdown...';
      importButton.disabled = true;
      vscode.postMessage({ type: 'import', markdown: markdown.value });
    });
    closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    window.addEventListener('message', event => {
      const message = event.data;
      status.textContent = message.type === 'working'
        ? 'Validating Markdown...'
        : message.message || '';
      status.dataset.state = message.type || '';
      if (message.type === 'working') {
        importButton.disabled = true;
        closeButton.disabled = true;
      } else if (message.type === 'success') {
        markdown.disabled = true;
        closeButton.disabled = false;
        closeButton.textContent = 'Close';
        window.setTimeout(() => vscode.postMessage({ type: 'close' }), 1200);
      } else {
        importButton.disabled = false;
        closeButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
