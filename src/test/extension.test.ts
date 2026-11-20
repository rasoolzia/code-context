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
import {
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
      "src/a.ts\nsrc/z.ts",
    );
    assert.strictEqual(generatePathList([]), "");
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
      "diff --git a/a.ts b/a.ts\n+new \n",
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
