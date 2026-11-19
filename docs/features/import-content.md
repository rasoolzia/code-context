# Import Content

## Purpose

Import a CodeContext Markdown content export into a workspace. The importer recreates the exported files and overwrites matching files only after explicit confirmation.

## User Workflow

1. Run **CodeContext: Import Content** from the Command Palette, or open the shared **CodeContext: Import** panel and select the **Import Content** tab.
2. Paste the complete CodeContext Markdown export into the multiline editor.
3. Select **Import Content**. Validation errors appear in the panel; invalid Markdown or unsafe paths are not written.
4. Choose a destination workspace folder if the current workspace has multiple roots.
5. Confirm the import. The confirmation states how many files will be created or updated.

Select **Cancel / Close** to close the panel without writing files. After a successful import, the panel reports the result and closes.

## Command

- Command ID: `code-context.importContent`
- Title: **CodeContext: Import Content**

## Markdown Format

The importer accepts the standard CodeContext `# Code Context` / `## Files` export format as well as reasonable CodeContext-like Markdown with plain file-path entries. Paths can be written as a backtick-quoted heading:

````markdown
# Code Context

## Files

### `src/example.ts`

```typescript
const value = 1;
```
````

It also accepts a plain path line, including surrounding whitespace:

For example, `  src/example.ts  ` is treated as the path `src/example.ts`.

Paths can be nested and use slash or backslash separators. Non-empty content uses a fenced code block; longer fences are supported, including content containing triple backticks. An empty file can be represented by a path entry followed by the next file entry or the end of the document, without a code fence. An explicit empty fenced block is also accepted.

## Multi-file Behavior

Every parsed file is created or updated under the selected workspace folder. Missing parent directories are created. Existing files are overwritten only after the confirmation dialog is accepted. In a multi-root workspace, choose the destination root before confirming.

## Path and Filesystem Safety

- Absolute paths are rejected.
- Paths containing a `..` segment are rejected.
- Duplicate normalized paths are rejected.
- Destinations that traverse symbolic links are rejected.
- All paths are joined beneath the selected workspace root; paths outside it are rejected.
- Destination types are checked before writing, so a directory cannot be overwritten as a file and parent components must be directories.

## Current Limitations

- Only CodeContext content exports are accepted; project-tree-only Markdown is not importable.
- One workspace folder is selected for the entire import; files cannot be routed to different roots in a multi-root workspace.
- Filesystem failures during the write phase are reported with the affected path, but earlier successful writes are not rolled back.
- The panel is an in-memory paste surface and does not save the pasted Markdown as a document.
- The shared panel also provides Import Project Tree and Import Paths tabs; each input format has its own parser.
