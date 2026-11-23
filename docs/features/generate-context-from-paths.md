# Generate Context from Paths

## Purpose

Generate context from a user-provided list of workspace-relative file paths. The user pastes paths into the panel, chooses an output type, and CodeContext generates the result using the same infrastructure as the existing Export Content and Git Diff commands.

This is a **Paths → Context** workflow. It is distinct from:

- **Import Paths** — creates empty files and directories from a path list (Paths → Structure)
- **Export Paths** — exports a list of paths from Explorer selections (Files → Paths)

## Command

Run **CodeContext: Generate Context from Paths** from the Command Palette to open the shared CodeContext panel on the **Generate Context** tab.

## Input Format

Paste one workspace-relative file path per line:

```text
src/components/Button.tsx
src/components/Input.tsx
src/lib/utils.ts
```

- One path per line.
- `/` and `\` separators are both accepted and normalized to `/`.
- Blank lines are ignored.
- Duplicate paths are deduplicated.
- Paths are sorted deterministically before processing.

## Output Types

Choose the desired output using the radio buttons below the textarea:

### Content

Generates a `# Code Context` Markdown document containing the file paths and their complete contents, identical in structure to the output of **Export Content**.

The existing `generateMarkdown` function is reused directly. The result opens as an editable untitled Markdown document.

### Git Diff

Generates a `# Git Diff` plain-text document scoped to the provided paths, identical in behavior to running **Git Diff** with those files selected in the Explorer.

Only changes relevant to the provided paths are included. Staged and unstaged changes, untracked files, deleted files, and renamed files are handled according to the existing Git Diff behavior. The result opens as an editable untitled plain-text document.

If the provided paths are valid but have no Git changes, CodeContext reports that no changes were found.

## Validation

All paths are validated before any output is generated:

- Absolute paths are rejected.
- Paths containing `..` traversal are rejected.
- Paths outside the workspace are rejected.
- Symbolic-link traversal through any path component is rejected.
- Paths that point to a directory are rejected; provide individual file paths.
- Null bytes and other unsafe characters are rejected.

**Content** additionally requires each path to exist in the working tree as a file. A missing path is rejected with a "File not found" error.

**Git Diff** does not require the path to exist on disk. A deleted tracked file no longer exists in the working tree but Git still has a record of its removal. Providing its path will include the deletion in the diff output. Paths that currently exist as directories are still rejected.

## Multi-Root Workspaces

For multi-root workspaces, CodeContext prompts you to choose the workspace folder that contains the provided paths before resolving them.

## Relationship to Other Features

| Feature | Direction | What it does |
|---|---|---|
| Export Content | Files → Markdown | Exports files selected in Explorer |
| Export Paths | Files → Path list | Exports paths selected in Explorer |
| Import Paths | Path list → Structure | Creates empty files/directories |
| **Generate Context from Paths** | **Path list → Context** | **Generates Content or Git Diff from pasted paths** |
