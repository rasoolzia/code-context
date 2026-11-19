import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { parseMarkdownContent } from "../core/markdown/markdown-parser";
import { parseProjectTree } from "../core/markdown/project-tree-parser";
import type { ContextFile } from "../core/models/context-file";
import type { FilesystemEntry } from "../core/models/filesystem-entry";
import { parsePathList } from "../core/paths/path-list-parser";
import { writeContextFiles } from "../infrastructure/vscode/context-file-writer";
import { createFilesystemStructure } from "../infrastructure/vscode/structure-writer";

export type ImportMode = "content" | "tree" | "paths";

type ImportPanelMessage =
  | {
      type: "import";
      mode: ImportMode;
      input: string;
    }
  | {
      type: "close";
    };

type PanelStatus =
  | "working"
  | "validation-error"
  | "import-error"
  | "cancelled"
  | "success";

export function openImportPanel(initialMode: ImportMode): void {
  const panel = vscode.window.createWebviewPanel(
    "codeContextImport",
    "CodeContext: Import",
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [] },
  );
  const nonce = randomBytes(18).toString("base64");
  panel.webview.html = getImportPanelHtml(nonce, initialMode);

  let isImporting = false;
  panel.webview.onDidReceiveMessage(async (message: ImportPanelMessage) => {
    if (message.type === "close") {
      panel.dispose();
      return;
    }

    if (isImporting || !isImportMode(message.mode)) {
      return;
    }

    isImporting = true;

    try {
      await panel.webview.postMessage({ type: "working" });
      await processImport(panel, message.mode, message.input);
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

async function processImport(
  panel: vscode.WebviewPanel,
  mode: ImportMode,
  input: string,
): Promise<void> {
  let contentFiles: ContextFile[] = [];
  let structureEntries: FilesystemEntry[] = [];

  try {
    if (mode === "content") {
      contentFiles = parseMarkdownContent(input);
    } else if (mode === "tree") {
      structureEntries = parseProjectTree(input);
    } else {
      structureEntries = parsePathList(input);
    }
  } catch (error) {
    postStatus(
      panel,
      "validation-error",
      error instanceof Error ? error.message : "The input is invalid.",
    );
    return;
  }

  const workspaceFolder = await chooseWorkspaceFolder();

  if (!workspaceFolder) {
    postStatus(panel, "cancelled", "Import cancelled. No files were changed.");
    return;
  }

  if (mode === "content") {
    const confirmation = await vscode.window.showWarningMessage(
      `Import ${contentFiles.length} file${contentFiles.length === 1 ? "" : "s"} into ${workspaceFolder.name}? Existing files will be overwritten.`,
      { modal: true },
      "Import",
    );

    if (confirmation !== "Import") {
      postStatus(
        panel,
        "cancelled",
        "Import cancelled. No files were changed.",
      );
      return;
    }

    await writeContextFiles(workspaceFolder, contentFiles);
    postStatus(
      panel,
      "success",
      `Imported ${contentFiles.length} file${contentFiles.length === 1 ? "" : "s"} into ${workspaceFolder.name}.`,
    );
    return;
  }

  await createFilesystemStructure(workspaceFolder, structureEntries);
  const fileCount = structureEntries.filter(
    (entry) => entry.type === "file",
  ).length;
  const directoryCount = structureEntries.length - fileCount;
  postStatus(
    panel,
    "success",
    `Processed ${directoryCount} director${directoryCount === 1 ? "y" : "ies"} and ${fileCount} file path${fileCount === 1 ? "" : "s"} in ${workspaceFolder.name}. Existing files were left unchanged.`,
  );
}

async function chooseWorkspaceFolder(): Promise<
  vscode.WorkspaceFolder | undefined
> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length === 0) {
    throw new Error("Open a workspace folder before importing.");
  }

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0];
  }

  const selection = await vscode.window.showQuickPick(
    workspaceFolders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    { placeHolder: "Choose the workspace folder for imported files" },
  );

  return selection?.folder;
}

function isImportMode(value: unknown): value is ImportMode {
  return value === "content" || value === "tree" || value === "paths";
}

function postStatus(
  panel: vscode.WebviewPanel,
  type: PanelStatus,
  message = "",
): void {
  void panel.webview.postMessage({ type, message });
}

function getImportPanelHtml(nonce: string, initialMode: ImportMode): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>CodeContext Import</title>
  <style>
    :root { color-scheme: light dark; }
    body { padding: 0 18px 18px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    main { max-width: 1100px; margin: 0 auto; }
    h1 { font-size: 1.35rem; margin: 18px 0 12px; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 14px; }
    .tab { color: var(--vscode-foreground); background: transparent; border-bottom: 2px solid transparent; }
    .tab[aria-selected="true"] { border-bottom-color: var(--vscode-focusBorder); }
    p { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
    label { display: block; margin-bottom: 8px; }
    textarea { box-sizing: border-box; display: block; width: 100%; min-height: 55vh; max-height: 72vh; resize: vertical; padding: 12px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); font: var(--vscode-editor-font-weight) var(--vscode-editor-font-size)/1.5 var(--vscode-editor-font-family); }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    button { padding: 6px 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.65; cursor: default; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    #status { min-height: 1.5em; margin-top: 12px; color: var(--vscode-errorForeground); white-space: pre-wrap; }
    #status[data-state="success"], #status[data-state="cancelled"] { color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <main>
    <h1>CodeContext Import</h1>
    <div class="tabs" role="tablist" aria-label="Import type">
      <button class="tab" id="tab-content" role="tab" type="button" data-mode="content">Import Content</button>
      <button class="tab" id="tab-tree" role="tab" type="button" data-mode="tree">Import Project Tree</button>
      <button class="tab" id="tab-paths" role="tab" type="button" data-mode="paths">Import Paths</button>
    </div>
    <p id="help"></p>
    <label id="input-label" for="input"></label>
    <textarea id="input" spellcheck="false"></textarea>
    <div class="actions">
      <button id="import" type="button">Import</button>
      <button id="close" class="secondary" type="button">Cancel / Close</button>
    </div>
    <div id="status" role="status" aria-live="polite"></div>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const help = document.getElementById('help');
    const label = document.getElementById('input-label');
    const importButton = document.getElementById('import');
    const closeButton = document.getElementById('close');
    const status = document.getElementById('status');
    const modes = {
      content: { help: 'Paste CodeContext Markdown here.', label: 'CodeContext Markdown', placeholder: '# Code Context\\n\\n## Files\\n\\n### src/example.ts\\n\\n' + String.fromCharCode(96).repeat(3) + 'typescript\\nPaste the complete export here\\n' + String.fromCharCode(96).repeat(3), action: 'Import Content' },
      tree: { help: 'Paste a project tree here.', label: 'Project Tree', placeholder: 'src/\\n├── app/\\n│   └── page.tsx', action: 'Import Project Tree' },
      paths: { help: 'Paste one relative file path per line.', label: 'File Paths', placeholder: 'src/app/page.tsx\\nsrc/components/Button.tsx', action: 'Import Paths' }
    };
    let activeMode = '${initialMode}';
    function selectMode(mode) {
      activeMode = mode;
      document.querySelectorAll('.tab').forEach(tab => {
        tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
      });
      help.textContent = modes[mode].help;
      label.textContent = modes[mode].label;
      input.placeholder = modes[mode].placeholder;
      importButton.textContent = modes[mode].action;
      status.textContent = '';
      status.dataset.state = '';
    }
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => selectMode(tab.dataset.mode));
    });
    selectMode(activeMode);
    importButton.addEventListener('click', () => {
      status.dataset.state = 'working';
      status.textContent = 'Validating input...';
      importButton.disabled = true;
      closeButton.disabled = true;
      vscode.postMessage({ type: 'import', mode: activeMode, input: input.value });
    });
    closeButton.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    window.addEventListener('message', event => {
      const message = event.data;
      status.textContent = message.type === 'working' ? 'Validating input...' : message.message || '';
      status.dataset.state = message.type || '';
      if (message.type === 'success') {
        input.disabled = true;
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
