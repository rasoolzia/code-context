import * as assert from "assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rename as renameDiskFile,
  rm,
  writeFile as writeDiskFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  generateBeforeAfterGitContext,
  generateGitDiffOutput,
} from "../core/git-context-generator";
import { generateMarkdown } from "../core/markdown/markdown-generator";
import { parseMarkdownContent } from "../core/markdown/markdown-parser";
import {
  generateProjectTree,
  type ProjectTreeEntry,
} from "../core/markdown/project-tree-generator";
import { parseProjectTree } from "../core/markdown/project-tree-parser";
import type { FilesystemEntry } from "../core/models/filesystem-entry";
import { generatePathList } from "../core/path-list-generator";
import { parsePathList } from "../core/paths/path-list-parser";
import { generateRouteReport } from "../core/routes/route-report-generator";
import type { FilesystemReader } from "../core/routes/route-scanner";
import { nextRouteScanner } from "../core/routes/scanners/next-route-scanner";
import { nuxtRouteScanner } from "../core/routes/scanners/nuxt-route-scanner";
import {
  collectChangedGitRepositories,
  findGitRepositories,
  getChangedGitFiles,
  getGitDiff,
  getGitFileAtHead,
  getWorkingGitFile,
  GitCommandError,
  GitRepositoryNotFoundError,
} from "../infrastructure/git/git-client";
import {
  collectProjectTree,
  collectResources,
} from "../infrastructure/vscode/resource-collector";
import { createFilesystemStructure } from "../infrastructure/vscode/structure-writer";
import { getRelativePath } from "../infrastructure/vscode/vscode-file-reader";

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
        vscode.Uri.joinPath(testRoot, "src", "empty"),
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

  test("parses one file from CodeContext Markdown", () => {
    const files = [
      {
        path: "src/example.ts",
        language: "typescript",
        content: "const value = 1;",
      },
    ];

    assert.deepStrictEqual(
      parseMarkdownContent(generateMarkdown(files)),
      files,
    );
  });

  test("parses a backtick-quoted path heading", () => {
    assert.deepStrictEqual(
      parseMarkdownContent(
        [
          "# Code Context",
          "## Files",
          "### `src/test.ts`",
          "```typescript",
          "const value = 1;",
          "```",
        ].join("\n"),
      ),
      [
        {
          path: "src/test.ts",
          language: "typescript",
          content: "const value = 1;",
        },
      ],
    );
  });

  test("parses a plain path with surrounding whitespace", () => {
    assert.deepStrictEqual(
      parseMarkdownContent(
        [
          "# Code Context",
          "## Files",
          "  src/test.ts  ",
          "```typescript",
          "const value = 1;",
          "```",
        ].join("\n"),
      ),
      [
        {
          path: "src/test.ts",
          language: "typescript",
          content: "const value = 1;",
        },
      ],
    );
  });

  test("parses multiple files and nested paths", () => {
    const files = [
      {
        path: "src/nested/example.ts",
        language: "typescript",
        content: "nested",
      },
      { path: "package.json", language: "json", content: "{}" },
    ];

    assert.deepStrictEqual(
      parseMarkdownContent(generateMarkdown(files)),
      files,
    );
  });

  test("normalizes backslash path separators", () => {
    const markdown = generateMarkdown([
      {
        path: "src\\nested\\example.ts",
        language: "typescript",
        content: "nested",
      },
    ]);

    assert.deepStrictEqual(parseMarkdownContent(markdown), [
      {
        path: "src/nested/example.ts",
        language: "typescript",
        content: "nested",
      },
    ]);
  });

  test("parses file content containing triple backticks", () => {
    const file = {
      path: "src/example.ts",
      language: "typescript",
      content: 'const fence = "```";\n',
    };

    assert.deepStrictEqual(parseMarkdownContent(generateMarkdown([file])), [
      file,
    ]);
  });

  test("parses longer code fences without truncating content", () => {
    const markdown = [
      "# Code Context",
      "",
      "## Files",
      "",
      "### `src/example.ts`",
      "",
      "````typescript",
      "```",
      "````",
      "",
    ].join("\n");

    assert.deepStrictEqual(parseMarkdownContent(markdown), [
      { path: "src/example.ts", language: "typescript", content: "```" },
    ]);
  });

  test("rejects duplicate paths", () => {
    const file = {
      path: "src/example.ts",
      language: "typescript",
      content: "first",
    };
    const markdown = generateMarkdown([
      file,
      { ...file, path: "src\\example.ts", content: "second" },
    ]);

    assert.throws(() => parseMarkdownContent(markdown), /more than once/);
  });

  test("rejects absolute paths", () => {
    const markdown = generateMarkdown([
      { path: "C:\\outside\\secret.ts", language: "typescript", content: "" },
    ]);

    assert.throws(() => parseMarkdownContent(markdown), /must be relative/);
  });

  test("rejects paths that escape the workspace", () => {
    const markdown = generateMarkdown([
      { path: "../outside.ts", language: "typescript", content: "" },
    ]);

    assert.throws(() => parseMarkdownContent(markdown), /cannot escape/);
  });

  test("rejects malformed CodeContext Markdown", () => {
    assert.throws(
      () =>
        parseMarkdownContent(
          "# Code Context\n\n## Files\n\n```typescript\ncode\n```\n",
        ),
      /file path/i,
    );
  });

  test("preserves empty file content", () => {
    const file = { path: "empty.txt", language: "plaintext", content: "" };

    assert.deepStrictEqual(parseMarkdownContent(generateMarkdown([file])), [
      file,
    ]);
  });

  test("parses a project tree with one file or directory root", () => {
    assert.deepStrictEqual(parseProjectTree("Button.tsx"), [
      { path: "Button.tsx", type: "file" },
    ]);
    assert.deepStrictEqual(parseProjectTree("components/"), [
      { path: "components", type: "directory" },
    ]);
  });

  test("parses nested trees, multiple roots, and empty directories", () => {
    const entries = parseProjectTree(
      [
        "src/",
        "├── app/",
        "│   └── page.tsx",
        "└── empty/",
        "",
        "components/",
        "└── Button.tsx",
      ].join("\n"),
    );

    assert.deepStrictEqual(entries, [
      { path: "components", type: "directory" },
      { path: "components/Button.tsx", type: "file" },
      { path: "src", type: "directory" },
      { path: "src/app", type: "directory" },
      { path: "src/app/page.tsx", type: "file" },
      { path: "src/empty", type: "directory" },
    ]);
  });

  test("accepts common ASCII tree connectors", () => {
    assert.deepStrictEqual(
      parseProjectTree("src/\n|-- app/\n|   `-- page.tsx"),
      [
        { path: "src", type: "directory" },
        { path: "src/app", type: "directory" },
        { path: "src/app/page.tsx", type: "file" },
      ],
    );
  });

  test("accepts consistently indented bullet-style trees", () => {
    assert.deepStrictEqual(
      parseProjectTree("- src/\n  - app/\n    - page.tsx"),
      [
        { path: "src", type: "directory" },
        { path: "src/app", type: "directory" },
        { path: "src/app/page.tsx", type: "file" },
      ],
    );
  });

  test("parses the Markdown output from Export Project Tree", () => {
    const tree = generateProjectTree([
      { path: "src", type: "directory" },
      { path: "src/app.ts", type: "file" },
    ]);

    assert.deepStrictEqual(parseProjectTree(tree), [
      { path: "src", type: "directory" },
      { path: "src/app.ts", type: "file" },
    ]);
  });

  test("deduplicates repeated tree entries and rejects type conflicts", () => {
    assert.deepStrictEqual(parseProjectTree("src/\nsrc/"), [
      { path: "src", type: "directory" },
    ]);
    assert.throws(
      () => parseProjectTree("foo\nfoo/"),
      /both a file and a directory/,
    );
    assert.throws(
      () => parseProjectTree("foo\nfoo/bar.ts"),
      /parent directory/,
    );
  });

  test("rejects malformed and unsafe project trees", () => {
    assert.throws(() => parseProjectTree(""), /project tree/i);
    assert.throws(
      () => parseProjectTree("│   └── orphan.ts"),
      /missing parent/i,
    );
    assert.throws(() => parseProjectTree("C:\\outside\\file.ts"), /relative/i);
    assert.throws(() => parseProjectTree("../outside.ts"), /escape/i);
    assert.throws(() => parseProjectTree("bad\0path.ts"), /relative/i);
  });

  test("parses, normalizes, and deduplicates path lists", () => {
    const entries = parsePathList(
      "\nsrc/app/page.tsx\r\nsrc\\app\\page.tsx\n src/components/Button.tsx \n",
    );

    assert.deepStrictEqual(entries, [
      { path: "src/app/page.tsx", type: "file" },
      { path: "src/components/Button.tsx", type: "file" },
    ]);
  });

  test("rejects invalid and conflicting path lists", () => {
    assert.throws(() => parsePathList("\n  \n"), /at least one/i);
    assert.throws(() => parsePathList("C:\\outside\\file.ts"), /relative/i);
    assert.throws(() => parsePathList("../outside.ts"), /escape/i);
    assert.throws(() => parsePathList("bad\0path.ts"), /relative/i);
    assert.throws(
      () => parsePathList("src/foo\nsrc/foo/bar.ts"),
      /parent directory/i,
    );
  });

  test("generates a deterministic normalized path list", () => {
    assert.strictEqual(
      generatePathList(["src\\z.ts", "src/a.ts", "src/a.ts"]),
      ["# Export Paths", "", "```text", "src/a.ts", "src/z.ts", "```", ""].join(
        "\n",
      ),
    );
    assert.strictEqual(
      generatePathList([]),
      ["# Export Paths", "", "```text", "```", ""].join("\n"),
    );
  });

  test("accepts an empty file without a fence before a non-empty file", () => {
    const markdown = [
      "# Code Context",
      "",
      "## Files",
      "",
      "### `src/test1.ts`",
      "",
      "",
      "### `src/test2.ts`",
      "",
      "```text",
      "two",
      "```",
    ].join("\n");

    assert.deepStrictEqual(parseMarkdownContent(markdown), [
      { path: "src/test1.ts", language: "", content: "" },
      { path: "src/test2.ts", language: "text", content: "two" },
    ]);
  });

  test("accepts an empty file at the end without a fence", () => {
    const markdown = [
      "# Code Context",
      "",
      "## Files",
      "",
      "src/empty.ts",
      "",
    ].join("\n");

    assert.deepStrictEqual(parseMarkdownContent(markdown), [
      { path: "src/empty.ts", language: "", content: "" },
    ]);
  });

  test("generates a tree for one file with its parent directories", () => {
    assert.strictEqual(
      generateProjectTree([{ path: "src/example.ts", type: "file" }]),
      [
        "# Project Tree",
        "",
        "```text",
        "src/",
        "└── example.ts",
        "```",
        "",
      ].join("\n"),
    );
  });

  test("generates multiple files in deterministic order", () => {
    const entries: ProjectTreeEntry[] = [
      { path: "z.ts", type: "file" },
      { path: "a.ts", type: "file" },
    ];

    assert.strictEqual(
      generateProjectTree(entries),
      generateProjectTree([...entries].reverse()),
    );
    assert.ok(
      generateProjectTree(entries).indexOf("a.ts") <
        generateProjectTree(entries).indexOf("z.ts"),
    );
  });

  test("renders nested directories and sibling files in a stable tree", () => {
    assert.strictEqual(
      generateProjectTree([
        { path: "src", type: "directory" },
        { path: "src/components", type: "directory" },
        { path: "src/components/button.tsx", type: "file" },
        { path: "src/components/input.tsx", type: "file" },
        { path: "src/app.tsx", type: "file" },
        { path: "src/main.tsx", type: "file" },
        { path: "package.json", type: "file" },
      ]),
      [
        "# Project Tree",
        "",
        "```text",
        "src/",
        "├── components/",
        "│   ├── button.tsx",
        "│   └── input.tsx",
        "├── app.tsx",
        "└── main.tsx",
        "package.json",
        "```",
        "",
      ].join("\n"),
    );
  });

  test("preserves empty directories", () => {
    assert.ok(
      generateProjectTree([{ path: "src/empty", type: "directory" }]).includes(
        "src/empty/",
      ),
    );
  });

  test("deduplicates overlapping tree paths", () => {
    const markdown = generateProjectTree([
      { path: "src", type: "directory" },
      { path: "src/nested", type: "directory" },
      { path: "src/nested/example.ts", type: "file" },
      { path: "src/nested/example.ts", type: "file" },
    ]);

    assert.strictEqual(markdown.split("example.ts").length - 1, 1);
    assert.strictEqual(markdown.split("src/nested/").length - 1, 1);
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

  test("collects workspace files when no Export Paths resource is selected", async () => {
    const root = testRoot;
    assert.ok(root);
    const expectedFile = vscode.Uri.joinPath(root, "src", "top.ts");
    const collected = await collectResources();

    assert.ok(
      collected.some(
        (uri) =>
          normalizePath(getRelativePath(uri)) ===
          normalizePath(getRelativePath(expectedFile)),
      ),
    );
    assert.ok(
      collected.every(
        (uri) => !uri.path.toLowerCase().includes("node_modules"),
      ),
    );
  });

  test("collects selected files and nested folders without duplicates", async () => {
    const root = testRoot;
    assert.ok(root);

    const selectedFile = vscode.Uri.joinPath(root, "src", "top.ts");
    const selectedFolder = vscode.Uri.joinPath(root, "src", "nested");
    const collected = await collectResources([
      selectedFile,
      selectedFolder,
      selectedFile,
    ]);

    assert.deepStrictEqual(
      collected.map((uri) => getRelativePath(uri)),
      ["src/nested/example.ts", "src/top.ts"],
    );
  });

  test("returns no files for a resource outside the workspace", async () => {
    const outsideResource = vscode.Uri.file(
      path.join(tmpdir(), `code-context-outside-${randomUUID()}.ts`),
    );

    assert.deepStrictEqual(await collectResources([outsideResource]), []);
  });

  test("creates structure without changing existing files", async () => {
    const root = testRoot;
    assert.ok(root);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(root);
    assert.ok(workspaceFolder);
    const existingFile = vscode.Uri.joinPath(root, "src", "top.ts");
    const newFile = vscode.Uri.joinPath(root, "src", "created", "empty.ts");
    const originalContent = await vscode.workspace.fs.readFile(existingFile);

    await createFilesystemStructure(workspaceFolder, [
      { path: "src/created", type: "directory" },
      { path: "src/created/empty.ts", type: "file" },
      { path: "src/top.ts", type: "file" },
    ]);

    assert.deepStrictEqual(
      await vscode.workspace.fs.readFile(existingFile),
      originalContent,
    );
    assert.strictEqual((await vscode.workspace.fs.readFile(newFile)).length, 0);
    assert.strictEqual(
      (
        await vscode.workspace.fs.stat(
          vscode.Uri.joinPath(root, "src", "created"),
        )
      ).type & vscode.FileType.Directory,
      vscode.FileType.Directory,
    );
  });

  test("rejects structure conflicts before creating files", async () => {
    const root = testRoot;
    assert.ok(root);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(root);
    assert.ok(workspaceFolder);
    const entries: FilesystemEntry[] = [
      { path: "new-parent", type: "file" },
      { path: "new-parent/child.ts", type: "file" },
    ];

    await assert.rejects(
      createFilesystemStructure(workspaceFolder, entries),
      /parent directory/i,
    );
    await assert.rejects(async () =>
      vscode.workspace.fs.stat(vscode.Uri.joinPath(root, "new-parent")),
    );
  });

  test("treats a selected nested file as the tree root", async () => {
    const root = testRoot;
    assert.ok(root);

    const selectedFile = vscode.Uri.joinPath(
      root,
      "src",
      "nested",
      "example.ts",
    );
    const entries = await collectProjectTree([selectedFile]);

    assert.deepStrictEqual(
      entries.map((entry) => `${entry.type}:${entry.path}`),
      ["file:example.ts"],
    );
  });

  test("treats a selected nested folder as the tree root", async () => {
    const root = testRoot;
    assert.ok(root);

    const selectedFolder = vscode.Uri.joinPath(root, "src", "nested");
    const entries = await collectProjectTree([selectedFolder]);

    assert.deepStrictEqual(
      entries.map((entry) => `${entry.type}:${entry.path}`),
      ["directory:nested", "file:nested/example.ts"],
    );
  });

  test("preserves empty folders beneath a selected root", async () => {
    const root = testRoot;
    assert.ok(root);

    const entries = await collectProjectTree([
      vscode.Uri.joinPath(root, "src"),
    ]);

    assert.ok(
      entries.some(
        (entry) => entry.type === "directory" && entry.path === "src/empty",
      ),
    );
  });

  test("keeps multiple selected resources as separate roots", async () => {
    const root = testRoot;
    assert.ok(root);

    const selectedFolder = vscode.Uri.joinPath(root, "src", "nested");
    const selectedFile = vscode.Uri.joinPath(root, "src", "top.ts");
    const entries = await collectProjectTree([selectedFolder, selectedFile]);

    assert.deepStrictEqual(
      entries.map((entry) => `${entry.type}:${entry.path}`),
      ["directory:nested", "file:nested/example.ts", "file:top.ts"],
    );
  });

  test("keeps workspace-relative paths when no resources are selected", async () => {
    const root = testRoot;
    assert.ok(root);

    const selectedFile = vscode.Uri.joinPath(
      root,
      "src",
      "nested",
      "example.ts",
    );
    const entries = await collectProjectTree();
    const expectedPath = getRelativePath(selectedFile).replace(/\\/g, "/");

    assert.ok(
      entries.some(
        (entry) => entry.type === "file" && entry.path === expectedPath,
      ),
    );
  });
});

suite("Git Context", () => {
  test("scopes changed files to selected files and folders without duplicates", async () => {
    await withTemporaryGitRepository(
      {
        "src/a.ts": "a before\n",
        "src/nested/b.ts": "b before\n",
        "src/nested/unchanged.ts": "unchanged\n",
        "other.ts": "other before\n",
      },
      async (root) => {
        await writeDiskFile(path.join(root, "src/a.ts"), "a after\n");
        await writeDiskFile(path.join(root, "src/nested/b.ts"), "b after\n");
        await writeDiskFile(path.join(root, "other.ts"), "other after\n");
        await writeDiskFile(path.join(root, "src/nested/new.ts"), "new file\n");

        const allChanges = await collectChangedGitRepositories([root]);
        assert.deepStrictEqual(
          allChanges[0].files.map((change) => change.path),
          ["other.ts", "src/a.ts", "src/nested/b.ts", "src/nested/new.ts"],
        );

        const selectedFile = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src", "a.ts")],
        );
        assert.deepStrictEqual(
          selectedFile[0].files.map((change) => change.path),
          ["src/a.ts"],
        );
        const selectedDiff = await getGitDiff(
          selectedFile[0].repository,
          selectedFile[0].files,
        );
        assert.ok(selectedDiff.includes("+a after"));
        assert.ok(!selectedDiff.includes("other after"));

        const selectedFiles = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src", "a.ts"), path.join(root, "other.ts")],
        );
        assert.deepStrictEqual(
          selectedFiles[0].files.map((change) => change.path),
          ["other.ts", "src/a.ts"],
        );

        const selectedFolder = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src", "nested")],
        );
        assert.deepStrictEqual(
          selectedFolder[0].files.map((change) => change.path),
          ["src/nested/b.ts", "src/nested/new.ts"],
        );

        const overlapping = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src"), path.join(root, "src", "a.ts")],
        );
        assert.deepStrictEqual(
          overlapping[0].files.map((change) => change.path),
          ["src/a.ts", "src/nested/b.ts", "src/nested/new.ts"],
        );

        const selectedChangedAndUnchanged = await collectChangedGitRepositories(
          [root],
          [
            path.join(root, "src", "a.ts"),
            path.join(root, "src", "nested", "unchanged.ts"),
          ],
        );
        assert.deepStrictEqual(
          selectedChangedAndUnchanged[0].files.map((change) => change.path),
          ["src/a.ts"],
        );

        const selectedNoChange = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src", "nested", "unchanged.ts")],
        );
        assert.deepStrictEqual(selectedNoChange[0].files, []);
      },
    );
  });

  test("scopes selections across multiple workspace repositories", async () => {
    await withTemporaryGitRepository(
      { "first.ts": "first\n" },
      async (firstRoot) => {
        await writeDiskFile(
          path.join(firstRoot, "first.ts"),
          "first changed\n",
        );

        await withTemporaryGitRepository(
          { "second.ts": "second\n" },
          async (secondRoot) => {
            await writeDiskFile(
              path.join(secondRoot, "second.ts"),
              "second changed\n",
            );

            const selected = await collectChangedGitRepositories(
              [firstRoot, secondRoot],
              [path.join(secondRoot, "second.ts")],
            );

            assert.deepStrictEqual(
              selected.find(
                (repository) => repository.repository.root === firstRoot,
              )?.files,
              [],
            );
            assert.deepStrictEqual(
              selected
                .find((repository) => repository.repository.root === secondRoot)
                ?.files.map((change) => change.path),
              ["second.ts"],
            );
          },
        );
      },
    );
  });

  test("detects staged and unstaged modifications and exports changes only", async () => {
    await withTemporaryGitRepository(
      {
        "staged.ts": [
          "const value = 1;",
          ...Array.from(
            { length: 10 },
            (_, index) => `const context${index} = true;`,
          ),
          "",
        ].join("\n"),
        "unstaged.ts": "const value = 3;\n",
      },
      async (root) => {
        await writeDiskFile(
          path.join(root, "staged.ts"),
          [
            "const value = 2;",
            ...Array.from(
              { length: 10 },
              (_, index) => `const context${index} = true;`,
            ),
            "",
          ].join("\n"),
        );
        runGitForTest(root, ["add", "staged.ts"]);
        await writeDiskFile(
          path.join(root, "staged.ts"),
          [
            "const value = 4;",
            ...Array.from(
              { length: 10 },
              (_, index) => `const context${index} = true;`,
            ),
            "",
          ].join("\n"),
        );
        await writeDiskFile(
          path.join(root, "unstaged.ts"),
          "const value = 5;\n",
        );

        const changes = await getChangedGitFiles({ root });
        const diff = await getGitDiff({ root }, changes);

        assert.deepStrictEqual(
          changes.map((change) => change.path),
          ["staged.ts", "unstaged.ts"],
        );
        assert.ok(diff.includes("-const value = 1;"));
        assert.ok(diff.includes("+const value = 4;"));
        assert.ok(diff.includes("-const value = 3;"));
        assert.ok(diff.includes("+const value = 5;"));
        assert.ok(!diff.includes("const context9 = true;"));
      },
    );
  });

  test("includes untracked files as added-file diffs", async () => {
    await withTemporaryGitRepository({}, async (root) => {
      await writeDiskFile(path.join(root, "new.ts"), "const added = true;\n");
      const changes = await getChangedGitFiles({ root });
      const diff = await getGitDiff({ root }, changes);

      assert.strictEqual(changes[0].untracked, true);
      assert.ok(diff.includes("new file mode"));
      assert.ok(diff.includes("+const added = true;"));
    });
  });

  test("handles deleted and renamed files", async () => {
    await withTemporaryGitRepository(
      {
        "old-name.ts": "export const value = true;\n",
        "deleted.ts": "remove me\n",
      },
      async (root) => {
        await renameDiskFile(
          path.join(root, "old-name.ts"),
          path.join(root, "new-name.ts"),
        );
        await rm(path.join(root, "deleted.ts"));
        runGitForTest(root, ["add", "-A"]);

        const changes = await getChangedGitFiles({ root });
        const rename = changes.find((change) => change.path === "new-name.ts");
        const deleted = changes.find((change) => change.path === "deleted.ts");

        assert.strictEqual(rename?.oldPath, "old-name.ts");
        assert.strictEqual(deleted?.status.includes("D"), true);

        const oldPathSelection = await collectChangedGitRepositories(
          [root],
          [path.join(root, "old-name.ts")],
        );
        const newPathSelection = await collectChangedGitRepositories(
          [root],
          [path.join(root, "new-name.ts")],
        );
        assert.deepStrictEqual(
          oldPathSelection[0].files.map((change) => change.path),
          ["new-name.ts"],
        );
        assert.deepStrictEqual(
          newPathSelection[0].files.map((change) => change.path),
          ["new-name.ts"],
        );
      },
    );
  });

  test("reports no changes and rejects non-Git workspaces", async () => {
    await withTemporaryGitRepository({}, async (root) => {
      assert.deepStrictEqual(await getChangedGitFiles({ root }), []);
    });

    const nonRepository = await mkdtemp(
      path.join(tmpdir(), `code-context-not-git-${randomUUID()}-`),
    );

    try {
      await assert.rejects(
        findGitRepositories([nonRepository]),
        GitRepositoryNotFoundError,
      );
    } finally {
      await rm(nonRepository, { recursive: true, force: true });
    }
  });

  test("reports Git command failures", async () => {
    await withTemporaryGitRepository({}, async (root) => {
      await rm(path.join(root, ".git"), { recursive: true, force: true });

      await assert.rejects(getChangedGitFiles({ root }), GitCommandError);
    });
  });

  test("Before/After output contains complete HEAD and working-tree contents", async () => {
    await withTemporaryGitRepository(
      { "src/example.ts": "const before = 1;\nconst unchanged = true;\n" },
      async (root) => {
        await writeDiskFile(
          path.join(root, "src/example.ts"),
          "const after = 2;\nconst unchanged = true;\n",
        );
        const before = await getGitFileAtHead({ root }, "src/example.ts");
        const after = await getWorkingGitFile({ root }, "src/example.ts");
        const output = generateBeforeAfterGitContext([
          {
            path: "src/example.ts",
            status: " M",
            before: before.content,
            after: after.content,
            beforeBinary: before.binary,
            afterBinary: after.binary,
          },
        ]);

        assert.ok(output.includes("const before = 1;"));
        assert.ok(output.includes("const after = 2;"));
        assert.ok(output.includes("const unchanged = true;"));
      },
    );
  });

  test("represents untracked files with empty before content and deleted after content", async () => {
    await withTemporaryGitRepository(
      { "deleted.ts": "complete old contents\n" },
      async (root) => {
        await writeDiskFile(
          path.join(root, "new.ts"),
          "complete new contents\n",
        );
        await rm(path.join(root, "deleted.ts"));
        const changes = await getChangedGitFiles({ root });
        const untracked = changes.find((change) => change.path === "new.ts");
        const deleted = changes.find((change) => change.path === "deleted.ts");
        assert.ok(untracked);
        assert.ok(deleted);

        const before = await getGitFileAtHead({ root }, deleted.path);
        const output = generateBeforeAfterGitContext([
          {
            path: untracked.path,
            status: untracked.status,
            before: "",
            after: (await getWorkingGitFile({ root }, untracked.path)).content,
            beforeBinary: false,
            afterBinary: false,
          },
          {
            path: deleted.path,
            status: deleted.status,
            before: before.content,
            after: "",
            beforeBinary: false,
            afterBinary: false,
          },
        ]);

        assert.ok(output.includes("complete old contents"));
        assert.ok(output.includes("complete new contents"));
        assert.ok(output.includes("### Before"));
        assert.ok(output.includes("### After"));
      },
    );
  });

  test("handles binary files without embedding binary data", async () => {
    await withTemporaryGitRepository({}, async (root) => {
      await writeDiskFile(
        path.join(root, "image.bin"),
        Buffer.from([0, 1, 2, 255]),
      );
      const changes = await getChangedGitFiles({ root });
      const diff = await getGitDiff({ root }, changes);
      const file = await getWorkingGitFile({ root }, "image.bin");
      const output = generateBeforeAfterGitContext([
        {
          path: "image.bin",
          status: "??",
          before: "",
          after: file.content,
          beforeBinary: false,
          afterBinary: file.binary,
        },
      ]);

      assert.ok(diff.includes("Binary files"));
      assert.strictEqual(file.binary, true);
      assert.ok(output.includes("[Binary content omitted]"));
    });
  });

  test("sorts Before/After sections deterministically and keeps Git Diff output raw", () => {
    const file = (filePath: string) => ({
      path: filePath,
      status: " M",
      before: "old",
      after: "new",
      beforeBinary: false,
      afterBinary: false,
    });
    const output = generateBeforeAfterGitContext([file("z.ts"), file("a.ts")]);

    assert.ok(output.indexOf("a.ts") < output.indexOf("z.ts"));
    assert.strictEqual(
      generateGitDiffOutput("diff --git a/a.ts b/a.ts\n+new \n"),
      "# Git Diff\n\ndiff --git a/a.ts b/a.ts\n+new \n",
    );
  });
});

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

async function withTemporaryGitRepository(
  initialFiles: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(
    path.join(tmpdir(), `code-context-git-${randomUUID()}-`),
  );

  try {
    runGitForTest(root, ["init", "-q"]);
    runGitForTest(root, ["config", "user.name", "CodeContext Test"]);
    runGitForTest(root, [
      "config",
      "user.email",
      "code-context@example.invalid",
    ]);

    for (const [filePath, content] of Object.entries(initialFiles)) {
      const absolutePath = path.join(root, ...filePath.split("/"));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeDiskFile(absolutePath, content);
    }

    if (Object.keys(initialFiles).length > 0) {
      runGitForTest(root, ["add", "--all"]);
      runGitForTest(root, ["commit", "-qm", "initial"]);
    }

    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runGitForTest(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
}

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

// ── Route Report ─────────────────────────────────────────────────────────────

/**
 * In-memory FilesystemReader for route scanner unit tests.
 * `structure` maps directory paths to arrays of child names.
 * Names ending with `/` are treated as directories; others as files.
 * `existingFiles` lists additional file paths that fileExists should return true for.
 */
function makeFs(
  structure: Record<string, string[]>,
  existingFiles: string[] = [],
  fileContents: Record<string, string> = {},
): FilesystemReader {
  const fileSet = new Set<string>(existingFiles);
  const contentMap = new Map(Object.entries(fileContents));
  const dirMap = new Map<string, { name: string; isDirectory: boolean }[]>();

  for (const [dir, children] of Object.entries(structure)) {
    dirMap.set(
      dir,
      children.map((child) => ({
        name: child.endsWith("/") ? child.slice(0, -1) : child,
        isDirectory: child.endsWith("/"),
      })),
    );

    for (const child of children) {
      if (!child.endsWith("/")) {
        fileSet.add(`${dir}/${child}`);
      }
    }
  }

  return {
    async readDirectory(directoryPath) {
      return dirMap.get(directoryPath) ?? undefined;
    },
    async readFile(filePath) {
      return contentMap.get(filePath);
    },
    async fileExists(filePath) {
      return fileSet.has(filePath);
    },
  };
}

suite("Route Report — Next.js scanner", () => {
  const root = "/workspace";

  function nextFs(structure: Record<string, string[]>, files: string[] = []) {
    return makeFs(structure, [`${root}/package.json`, ...files], {
      [`${root}/package.json`]: JSON.stringify({
        dependencies: { next: "^14.0.0" },
      }),
    });
  }

  test("App Router: root route from app/page.tsx", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/");
    assert.strictEqual(routes[0].source, "app/page.tsx");
    assert.strictEqual(routes[0].type, "static");
  });

  test("App Router: static nested route", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["about/"],
      [`${root}/app/about`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/about");
    assert.strictEqual(routes[0].source, "app/about/page.tsx");
    assert.strictEqual(routes[0].type, "static");
  });

  test("App Router: dynamic segment [id]", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["users/"],
      [`${root}/app/users`]: ["[id]/"],
      [`${root}/app/users/[id]`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/users/[id]");
    assert.strictEqual(routes[0].source, "app/users/[id]/page.tsx");
    assert.strictEqual(routes[0].type, "dynamic");
  });

  test("App Router: catch-all [...slug]", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["docs/"],
      [`${root}/app/docs`]: ["[...slug]/"],
      [`${root}/app/docs/[...slug]`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/docs/[...slug]");
    assert.strictEqual(routes[0].source, "app/docs/[...slug]/page.tsx");
    assert.strictEqual(routes[0].type, "catch-all");
  });

  test("App Router: optional catch-all [[...slug]]", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["shop/"],
      [`${root}/app/shop`]: ["[[...slug]]/"],
      [`${root}/app/shop/[[...slug]]`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/shop/[[...slug]]");
    assert.strictEqual(routes[0].source, "app/shop/[[...slug]]/page.tsx");
    assert.strictEqual(routes[0].type, "optional-catch-all");
  });

  test("App Router: route group (marketing) is transparent to URL", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["(marketing)/"],
      [`${root}/app/(marketing)`]: ["about/"],
      [`${root}/app/(marketing)/about`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/about");
    assert.strictEqual(routes[0].source, "app/(marketing)/about/page.tsx");
  });

  test("App Router: private folder _components is excluded from routing", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["_components/", "page.tsx"],
      [`${root}/app/_components`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/");
  });

  test("App Router: parallel and intercepting route folders are excluded", async () => {
    const fs = nextFs({
      [`${root}/app`]: [
        "@modal/",
        "(.)photo/",
        "(..)photo/",
        "(...)photo/",
        "page.tsx",
      ],
      [`${root}/app/@modal`]: ["page.tsx"],
      [`${root}/app/(.)photo`]: ["page.tsx"],
      [`${root}/app/(..)photo`]: ["page.tsx"],
      [`${root}/app/(...)photo`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.deepStrictEqual(routes, [
      { route: "/", source: "app/page.tsx", type: "static" },
    ]);
  });

  test("App Router: src/app layout uses workspace-relative source paths", async () => {
    const fs = nextFs({
      [`${root}/src/app`]: ["users/"],
      [`${root}/src/app/users`]: ["[id]/"],
      [`${root}/src/app/users/[id]`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.deepStrictEqual(routes, [
      {
        route: "/users/[id]",
        source: "src/app/users/[id]/page.tsx",
        type: "dynamic",
      },
    ]);
  });

  test("App Router: non-route files (layout, loading, error) are ignored", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["layout.tsx", "loading.tsx", "page.tsx", "error.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/");
  });

  test("App Router: multiple routes are sorted deterministically", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["page.tsx", "about/", "users/"],
      [`${root}/app/about`]: ["page.tsx"],
      [`${root}/app/users`]: ["page.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.deepStrictEqual(
      routes.map((r) => r.route),
      ["/", "/about", "/users"],
    );
  });

  test("App Router: no route files returns empty array", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["layout.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 0);
  });

  test("App Router: all supported page extensions are recognised", async () => {
    const fs = nextFs({
      [`${root}/app`]: ["a/", "b/", "c/", "d/", "e/"],
      [`${root}/app/a`]: ["page.tsx"],
      [`${root}/app/b`]: ["page.ts"],
      [`${root}/app/c`]: ["page.jsx"],
      [`${root}/app/d`]: ["page.js"],
      [`${root}/app/e`]: ["page.mdx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 5);
  });

  test("Pages Router: index.tsx maps to /", async () => {
    const fs = nextFs({
      [`${root}/pages`]: ["index.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/");
    assert.strictEqual(routes[0].source, "pages/index.tsx");
  });

  test("Pages Router: about.tsx maps to /about", async () => {
    const fs = nextFs({
      [`${root}/pages`]: ["about.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes[0].route, "/about");
  });

  test("Pages Router: nested [id].tsx maps to /users/[id]", async () => {
    const fs = nextFs({
      [`${root}/pages`]: ["users/"],
      [`${root}/pages/users`]: ["[id].tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes[0].route, "/users/[id]");
    assert.strictEqual(routes[0].source, "pages/users/[id].tsx");
    assert.strictEqual(routes[0].type, "dynamic");
  });

  test("Pages Router: src/pages layout includes src in source paths", async () => {
    const fs = nextFs({
      [`${root}/src/pages`]: ["index.tsx", "users/"],
      [`${root}/src/pages/users`]: ["[id].tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.deepStrictEqual(routes, [
      { route: "/", source: "src/pages/index.tsx", type: "static" },
      {
        route: "/users/[id]",
        source: "src/pages/users/[id].tsx",
        type: "dynamic",
      },
    ]);
  });

  test("Pages Router: _app and _document are ignored", async () => {
    const fs = nextFs({
      [`${root}/pages`]: ["_app.tsx", "_document.tsx", "index.tsx"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/");
  });

  test("Pages Router: non-.tsx/.ts/.jsx/.js files are ignored", async () => {
    const fs = nextFs({
      [`${root}/pages`]: ["index.tsx", "styles.css", "README.md"],
    });
    const routes = await nextRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
  });
});

suite("Route Report — Nuxt scanner", () => {
  const root = "/workspace";

  function nuxtFs(structure: Record<string, string[]>) {
    return makeFs(structure, [`${root}/package.json`], {
      [`${root}/package.json`]: JSON.stringify({
        dependencies: { nuxt: "^3.0.0" },
      }),
    });
  }

  test("pages/index.vue maps to /", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["index.vue"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].route, "/");
    assert.strictEqual(routes[0].source, "pages/index.vue");
    assert.strictEqual(routes[0].type, "static");
  });

  test("pages/about.vue maps to /about", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["about.vue"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes[0].route, "/about");
    assert.strictEqual(routes[0].type, "static");
  });

  test("pages/users/index.vue maps to /users", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["users/"],
      [`${root}/pages/users`]: ["index.vue"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes[0].route, "/users");
  });

  test("pages/users/[id].vue maps to /users/[id]", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["users/"],
      [`${root}/pages/users`]: ["[id].vue"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes[0].route, "/users/[id]");
    assert.strictEqual(routes[0].source, "pages/users/[id].vue");
    assert.strictEqual(routes[0].type, "dynamic");
  });

  test("pages/docs/[...slug].vue maps to /docs/[...slug]", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["docs/"],
      [`${root}/pages/docs`]: ["[...slug].vue"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes[0].route, "/docs/[...slug]");
    assert.strictEqual(routes[0].type, "catch-all");
  });

  test("Nuxt 3 pages layout detects and scans common routes", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["index.vue", "about.vue", "projects.vue", "blog/"],
      [`${root}/pages/blog`]: ["index.vue", "[slug].vue"],
    });

    assert.strictEqual(await nuxtRouteScanner.detect(root, fs), true);
    assert.deepStrictEqual(await nuxtRouteScanner.scan(root, fs), [
      { route: "/", source: "pages/index.vue", type: "static" },
      { route: "/about", source: "pages/about.vue", type: "static" },
      { route: "/blog", source: "pages/blog/index.vue", type: "static" },
      {
        route: "/blog/[slug]",
        source: "pages/blog/[slug].vue",
        type: "dynamic",
      },
      { route: "/projects", source: "pages/projects.vue", type: "static" },
    ]);
  });

  test("Nuxt 4 app/pages layout detects and scans common routes", async () => {
    const fs = nuxtFs({
      [`${root}/app`]: ["pages/"],
      [`${root}/app/pages`]: [
        "index.vue",
        "about.vue",
        "projects.vue",
        "blog/",
      ],
      [`${root}/app/pages/blog`]: ["index.vue", "[...slug].vue"],
    });

    assert.strictEqual(await nuxtRouteScanner.detect(root, fs), true);
    assert.deepStrictEqual(await nuxtRouteScanner.scan(root, fs), [
      { route: "/", source: "app/pages/index.vue", type: "static" },
      { route: "/about", source: "app/pages/about.vue", type: "static" },
      { route: "/blog", source: "app/pages/blog/index.vue", type: "static" },
      {
        route: "/blog/[...slug]",
        source: "app/pages/blog/[...slug].vue",
        type: "catch-all",
      },
      { route: "/projects", source: "app/pages/projects.vue", type: "static" },
    ]);
  });

  test("app/pages takes precedence when both Nuxt pages layouts exist", async () => {
    const fs = nuxtFs({
      [`${root}/app`]: ["pages/"],
      [`${root}/app/pages`]: ["about.vue"],
      [`${root}/pages`]: ["index.vue", "about.vue"],
    });

    assert.deepStrictEqual(await nuxtRouteScanner.scan(root, fs), [
      { route: "/about", source: "app/pages/about.vue", type: "static" },
    ]);
  });

  test("non-.vue files are ignored", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["index.vue", "styles.css", "utils.ts"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 1);
  });

  test("multiple routes are sorted deterministically", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["index.vue", "about.vue", "users/"],
      [`${root}/pages/users`]: ["index.vue", "[id].vue"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.deepStrictEqual(
      routes.map((r) => r.route),
      ["/", "/about", "/users", "/users/[id]"],
    );
  });

  test("no route files returns empty array", async () => {
    const fs = nuxtFs({
      [`${root}/pages`]: ["utils.ts"],
    });
    const routes = await nuxtRouteScanner.scan(root, fs);

    assert.strictEqual(routes.length, 0);
  });
});

suite("Route Report — detection", () => {
  test("Next.js is not detected without package.json", async () => {
    const root = "/workspace";
    const fs = makeFs({ [`${root}/app`]: ["page.tsx"] });
    const detected = await nextRouteScanner.detect(root, fs);

    assert.strictEqual(detected, false);
  });

  test("Nuxt is not detected without package.json", async () => {
    const root = "/workspace";
    const fs = makeFs({ [`${root}/pages`]: ["index.vue"] });
    const detected = await nuxtRouteScanner.detect(root, fs);

    assert.strictEqual(detected, false);
  });

  test("Next.js is detected from injected package.json and app directory", async () => {
    const root = "/workspace";
    const pkgPath = `${root}/package.json`;
    const fs = makeFs({ [`${root}/app`]: ["page.tsx"] }, [pkgPath], {
      [pkgPath]: JSON.stringify({ dependencies: { next: "^14.0.0" } }),
    });

    assert.strictEqual(await nextRouteScanner.detect(root, fs), true);
  });

  test("Nuxt is detected from injected package.json and pages directory", async () => {
    const root = "/workspace";
    const pkgPath = `${root}/package.json`;
    const fs = makeFs({ [`${root}/pages`]: ["index.vue"] }, [pkgPath], {
      [pkgPath]: JSON.stringify({ dependencies: { nuxt: "^3.0.0" } }),
    });

    assert.strictEqual(await nuxtRouteScanner.detect(root, fs), true);
  });

  test("projects without framework dependencies are not detected", async () => {
    const root = "/workspace";
    const pkgPath = `${root}/package.json`;
    const fs = makeFs(
      {
        [`${root}/app`]: ["page.tsx"],
        [`${root}/pages`]: ["index.vue"],
      },
      [pkgPath],
      { [pkgPath]: JSON.stringify({ dependencies: { react: "^18.0.0" } }) },
    );

    assert.strictEqual(await nextRouteScanner.detect(root, fs), false);
    assert.strictEqual(await nuxtRouteScanner.detect(root, fs), false);
  });
});

suite("Route Report — report generator", () => {
  test("generates a Markdown report with framework and route table", () => {
    const report = generateRouteReport("Next.js", [
      { route: "/", source: "app/page.tsx", type: "static" },
      {
        route: "/users/[id]",
        source: "app/users/[id]/page.tsx",
        type: "dynamic",
      },
    ]);

    assert.ok(report.startsWith("# Route Report"));
    assert.ok(report.includes("## Framework"));
    assert.ok(report.includes("Next.js"));
    assert.ok(report.includes("## Routes"));
    assert.ok(report.includes("`/`"));
    assert.ok(report.includes("`/users/[id]`"));
    assert.ok(report.includes("Static"));
    assert.ok(report.includes("Dynamic"));
  });

  test("empty routes produces no-routes message", () => {
    const report = generateRouteReport("Next.js", []);

    assert.ok(report.includes("*No routes found.*"));
  });

  test("report is deterministic for the same input", () => {
    const routes = [
      {
        route: "/about",
        source: "app/about/page.tsx",
        type: "static" as const,
      },
      { route: "/", source: "app/page.tsx", type: "static" as const },
    ];

    assert.strictEqual(
      generateRouteReport("Next.js", routes),
      generateRouteReport("Next.js", routes),
    );
  });

  test("pipe characters in route paths are escaped", () => {
    const report = generateRouteReport("Next.js", [
      { route: "/a|b", source: "app/a|b/page.tsx", type: "static" },
    ]);

    assert.ok(report.includes("\\|"));
  });

  test("all route types are labelled correctly", () => {
    const report = generateRouteReport("Next.js", [
      { route: "/a", source: "app/a/page.tsx", type: "static" },
      { route: "/b/[id]", source: "app/b/[id]/page.tsx", type: "dynamic" },
      {
        route: "/c/[...s]",
        source: "app/c/[...s]/page.tsx",
        type: "catch-all",
      },
      {
        route: "/d/[[...s]]",
        source: "app/d/[[...s]]/page.tsx",
        type: "optional-catch-all",
      },
    ]);

    assert.ok(report.includes("Static"));
    assert.ok(report.includes("Dynamic"));
    assert.ok(report.includes("Catch-all"));
    assert.ok(report.includes("Optional catch-all"));
  });
});

suite("Route Report — integration (scanner → model → report)", () => {
  test("Next.js App Router full scan produces correct Markdown report", async () => {
    const root = "/workspace";
    const fs = makeFs(
      {
        [`${root}/app`]: ["page.tsx", "about/", "users/"],
        [`${root}/app/about`]: ["page.tsx"],
        [`${root}/app/users`]: ["[id]/"],
        [`${root}/app/users/[id]`]: ["page.tsx"],
      },
      [`${root}/package.json`],
    );

    const routes = await nextRouteScanner.scan(root, fs);
    const report = generateRouteReport(nextRouteScanner.frameworkName, routes);

    assert.ok(report.includes("Next.js"));
    assert.ok(report.includes("`/`"));
    assert.ok(report.includes("`/about`"));
    assert.ok(report.includes("`/users/[id]`"));
    assert.ok(report.includes("Dynamic"));
    assert.ok(report.indexOf("`/`") < report.indexOf("`/about`"));
    assert.ok(report.indexOf("`/about`") < report.indexOf("`/users/[id]`"));
  });

  test("Nuxt full scan produces correct Markdown report", async () => {
    const root = "/workspace";
    const fs = makeFs(
      {
        [`${root}/pages`]: ["index.vue", "about.vue", "users/"],
        [`${root}/pages/users`]: ["[id].vue"],
      },
      [`${root}/package.json`],
    );

    const routes = await nuxtRouteScanner.scan(root, fs);
    const report = generateRouteReport(nuxtRouteScanner.frameworkName, routes);

    assert.ok(report.includes("Nuxt"));
    assert.ok(report.includes("`/`"));
    assert.ok(report.includes("`/about`"));
    assert.ok(report.includes("`/users/[id]`"));
  });

  test("routeReport command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("code-context.routeReport"));
  });
});

suite("Generate Context from Paths", () => {
  const { resolvePathsToUris } =
    require("../commands/generate-context-from-paths") as typeof import("../commands/generate-context-from-paths");

  let genRoot: vscode.Uri | undefined;

  suiteSetup(async () => {
    const temporaryPath = await mkdtemp(
      path.join(tmpdir(), `code-context-gen-${randomUUID()}-`),
    );
    genRoot = vscode.Uri.file(temporaryPath);
    await updateTestWorkspaceFolder(genRoot, true);
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(genRoot, "src"),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(genRoot, "src", "a-gen.ts"),
      new TextEncoder().encode("const a = 1;"),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(genRoot, "src", "z-gen.ts"),
      new TextEncoder().encode("const z = 26;"),
    );
  });

  suiteTeardown(async () => {
    if (genRoot) {
      const temporaryPath = genRoot.fsPath;
      try {
        await updateTestWorkspaceFolder(genRoot, false);
      } finally {
        genRoot = undefined;
        await rm(temporaryPath, { recursive: true, force: true });
      }
    }
  });

  function getFolder(): vscode.WorkspaceFolder {
    const folder = genRoot && vscode.workspace.getWorkspaceFolder(genRoot);
    assert.ok(folder, "test workspace folder not found");
    return folder;
  }

  // ── Path parsing via resolvePathsToUris ───────────────────────────────────

  test("resolves a single path", async () => {
    const uris = await resolvePathsToUris("src/a-gen.ts", getFolder());
    assert.strictEqual(uris.length, 1);
    assert.ok(uris[0].path.endsWith("a-gen.ts"));
  });

  test("resolves multiple paths", async () => {
    const uris = await resolvePathsToUris(
      "src/a-gen.ts\nsrc/z-gen.ts",
      getFolder(),
    );
    assert.strictEqual(uris.length, 2);
  });

  test("resolves nested paths", async () => {
    const uris = await resolvePathsToUris("src/a-gen.ts", getFolder());
    assert.ok(uris[0].path.includes("src"));
  });

  test("normalizes Windows backslashes", async () => {
    const uris = await resolvePathsToUris("src\\a-gen.ts", getFolder());
    assert.strictEqual(uris.length, 1);
    assert.ok(uris[0].path.endsWith("a-gen.ts"));
  });

  test("ignores blank lines", async () => {
    const uris = await resolvePathsToUris(
      "\nsrc/a-gen.ts\n  \nsrc/z-gen.ts\n",
      getFolder(),
    );
    assert.strictEqual(uris.length, 2);
  });

  test("deduplicates paths", async () => {
    const uris = await resolvePathsToUris(
      "src/a-gen.ts\nsrc/a-gen.ts",
      getFolder(),
    );
    assert.strictEqual(uris.length, 1);
  });

  test("sorts paths deterministically", async () => {
    const uris = await resolvePathsToUris(
      "src/z-gen.ts\nsrc/a-gen.ts",
      getFolder(),
    );
    assert.ok(uris[0].path.endsWith("a-gen.ts"));
    assert.ok(uris[1].path.endsWith("z-gen.ts"));
  });

  test("rejects empty input", async () => {
    await assert.rejects(
      resolvePathsToUris("   \n  \n", getFolder()),
      /at least one/i,
    );
  });

  test("rejects absolute paths", async () => {
    await assert.rejects(
      resolvePathsToUris("/etc/passwd", getFolder()),
      /relative/i,
    );
    await assert.rejects(
      resolvePathsToUris("C:\\secret.ts", getFolder()),
      /relative/i,
    );
  });

  test("rejects traversal paths", async () => {
    await assert.rejects(
      resolvePathsToUris("../outside.ts", getFolder()),
      /escape/i,
    );
  });

  test("rejects a directory path (content mode)", async () => {
    await assert.rejects(
      resolvePathsToUris("src", getFolder(), "content"),
      /directory/i,
    );
  });

  test("rejects a directory path (gitDiff mode)", async () => {
    await assert.rejects(
      resolvePathsToUris("src", getFolder(), "gitDiff"),
      /directory/i,
    );
  });

  test("rejects a missing path in content mode", async () => {
    await assert.rejects(
      resolvePathsToUris("does-not-exist-xyz/file.ts", getFolder(), "content"),
      /not found/i,
    );
  });

  test("allows a missing path in gitDiff mode (deleted file)", async () => {
    const uris = await resolvePathsToUris(
      "does-not-exist-xyz/deleted.ts",
      getFolder(),
      "gitDiff",
    );
    assert.strictEqual(uris.length, 1);
    assert.ok(uris[0].path.endsWith("deleted.ts"));
  });

  // ── Content integration ───────────────────────────────────────────────────

  test("content output produces Code Context Markdown via existing generator", async () => {
    const { generateContextFromPaths } =
      require("../commands/generate-context-from-paths") as typeof import("../commands/generate-context-from-paths");
    const openedDocuments: vscode.TextDocument[] = [];
    const subscription = vscode.workspace.onDidOpenTextDocument((document) => {
      openedDocuments.push(document);
    });

    let generated: boolean;

    try {
      generated = await generateContextFromPaths(
        "src/z-gen.ts\nsrc/a-gen.ts",
        "content",
      );
    } finally {
      subscription.dispose();
    }

    assert.strictEqual(generated, true);
    const document = openedDocuments.find(
      (openedDocument) =>
        openedDocument.languageId === "markdown" &&
        openedDocument.getText().startsWith("# Code Context"),
    );
    assert.ok(document, "generated Markdown document was not opened");
    const markdown = document.getText();

    assert.ok(markdown.startsWith("# Code Context"));
    assert.ok(markdown.includes("a-gen.ts"));
    assert.ok(markdown.includes("z-gen.ts"));
    assert.ok(markdown.indexOf("a-gen.ts") < markdown.indexOf("z-gen.ts"));
    assert.ok(markdown.includes("const a = 1;"));
    assert.ok(markdown.includes("const z = 26;"));
  });

  // ── Git Diff: deleted file regression ────────────────────────────────────

  test("gitDiff mode includes a deleted tracked file", async () => {
    await withTemporaryGitRepository(
      {
        "src/deleted.ts": "const removed = true;\n",
        "src/other.ts": "other\n",
      },
      async (root) => {
        await rm(path.join(root, "src", "deleted.ts"));
        runGitForTest(root, ["add", "-A"]);

        const selected = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src", "deleted.ts")],
        );
        assert.strictEqual(selected[0].files.length, 1);
        assert.strictEqual(selected[0].files[0].path, "src/deleted.ts");

        const diff = await getGitDiff(
          selected[0].repository,
          selected[0].files,
        );
        assert.ok(diff.includes("-const removed = true;"));
        assert.ok(!diff.includes("other"));
      },
    );
  });

  test("gitDiff mode: renamed file is found via old path", async () => {
    await withTemporaryGitRepository(
      { "old.ts": "export const v = 1;\n" },
      async (root) => {
        await renameDiskFile(
          path.join(root, "old.ts"),
          path.join(root, "new.ts"),
        );
        runGitForTest(root, ["add", "-A"]);

        // Selecting the old path should surface the rename change
        const selected = await collectChangedGitRepositories(
          [root],
          [path.join(root, "old.ts")],
        );
        assert.strictEqual(selected[0].files.length, 1);
        assert.strictEqual(selected[0].files[0].path, "new.ts");
        assert.strictEqual(selected[0].files[0].oldPath, "old.ts");
      },
    );
  });

  // ── Git Diff integration ──────────────────────────────────────────────────

  test("gitDiff mode scopes diff to requested paths and excludes unrelated files", async () => {
    await withTemporaryGitRepository(
      { "src/a.ts": "a before\n", "other.ts": "other before\n" },
      async (root) => {
        await writeDiskFile(path.join(root, "src/a.ts"), "a after\n");
        await writeDiskFile(path.join(root, "other.ts"), "other after\n");

        const selected = await collectChangedGitRepositories(
          [root],
          [path.join(root, "src", "a.ts")],
        );
        const diff = await getGitDiff(
          selected[0].repository,
          selected[0].files,
        );

        assert.ok(diff.includes("+a after"));
        assert.ok(!diff.includes("other after"));
      },
    );
  });

  // ── Command registration ──────────────────────────────────────────────────

  test("generateContextFromPaths command is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("code-context.generateContextFromPaths"));
  });
});
