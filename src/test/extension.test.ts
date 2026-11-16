import * as assert from "assert";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { generateMarkdown } from "../core/markdown/markdown-generator";
import { collectResources } from "../infrastructure/vscode/resource-collector";

suite("Export Content", () => {
  let testRoot: vscode.Uri | undefined;

  suiteSetup(async () => {
    const temporaryPath = await mkdtemp(
      path.join(tmpdir(), `code-context-test-${randomUUID()}-`),
    );
    testRoot = vscode.Uri.file(temporaryPath);

    try {
      await updateTestWorkspaceFolder(testRoot, true);
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(testRoot, "src", "nested"),
      );
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(testRoot, "node_modules", "ignored"),
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(testRoot, "src", "top.ts"),
        new TextEncoder().encode("export const top = true;"),
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(testRoot, "src", "nested", "example.ts"),
        new TextEncoder().encode("export const nested = true;"),
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(testRoot, "node_modules", "ignored", "package.js"),
        new TextEncoder().encode("ignored"),
      );
    } catch (error) {
      try {
        await updateTestWorkspaceFolder(testRoot, false);
      } finally {
        testRoot = undefined;
        await rm(temporaryPath, { recursive: true, force: true });
      }

      throw error;
    }
  });

  suiteTeardown(async () => {
    if (testRoot) {
      const temporaryPath = testRoot.fsPath;

      try {
        await updateTestWorkspaceFolder(testRoot, false);
      } finally {
        testRoot = undefined;
        await rm(temporaryPath, { recursive: true, force: true });
      }
    }
  });

  test("generates Markdown for one file", () => {
    const markdown = generateMarkdown([
      {
        path: "src/example.ts",
        language: "typescript",
        content: "const value = 1;",
      },
    ]);

    assert.strictEqual(
      markdown,
      [
        "# Code Context",
        "",
        "## Files",
        "",
        "### `src/example.ts`",
        "",
        "```typescript",
        "const value = 1;",
        "```",
        "",
      ].join("\n"),
    );
  });

  test("generates multiple files in path order", () => {
    const markdown = generateMarkdown([
      { path: "z.ts", language: "typescript", content: "z" },
      { path: "a.ts", language: "typescript", content: "a" },
    ]);

    assert.ok(markdown.indexOf("### `a.ts`") < markdown.indexOf("### `z.ts`"));
  });

  test("uses a safe fence when content contains triple backticks", () => {
    const markdown = generateMarkdown([
      {
        path: "src/example.ts",
        language: "typescript",
        content: "```ts\nconst value = 1;\n```",
      },
    ]);

    assert.ok(markdown.includes("````typescript"));
    assert.ok(markdown.includes("\n````\n"));
  });

  test("recursively collects files, prunes ignored directories, and deduplicates", async () => {
    const root = testRoot;
    assert.ok(root);

    const nestedFile = vscode.Uri.joinPath(root, "src", "nested", "example.ts");
    const collected = await collectResources([root, nestedFile, root]);
    const relativePaths = collected.map((uri) =>
      uri.path.slice(root.path.length + 1),
    );

    assert.deepStrictEqual(relativePaths, [
      "src/nested/example.ts",
      "src/top.ts",
    ]);
  });
});

async function updateTestWorkspaceFolder(
  uri: vscode.Uri,
  add: boolean,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const uriKey = uri.toString();
  const existingIndex = folders.findIndex(
    (folder) => folder.uri.toString() === uriKey,
  );

  if (add && existingIndex >= 0) {
    throw new Error("The temporary test workspace is already open.");
  }

  if (!add && existingIndex < 0) {
    return;
  }

  const index = add ? folders.length : existingIndex;

  await new Promise<void>((resolve, reject) => {
    let subscription: vscode.Disposable;
    subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      const changedFolders = add ? event.added : event.removed;

      if (changedFolders.some((folder) => folder.uri.toString() === uriKey)) {
        subscription.dispose();
        resolve();
      }
    });

    try {
      const updated = add
        ? vscode.workspace.updateWorkspaceFolders(index, 0, { uri })
        : vscode.workspace.updateWorkspaceFolders(index, 1);

      if (!updated) {
        throw new Error("Unable to update the temporary test workspace.");
      }
    } catch (error) {
      subscription.dispose();
      reject(error);
    }
  });
}
