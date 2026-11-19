# Export Content

## Purpose

Export source files and their contents into a new native untitled Markdown document. The generated document is editable, can be saved with Ctrl+S or Save As, and is not automatically written to the workspace.

## Supported Selections

Run **CodeContext: Export Content** from an Explorer context menu to export a selected file, multiple selected files, a folder recursively, or multiple files and folders. Overlapping selections are deduplicated. With no Explorer resource, the command exports every open workspace folder, including multi-root workspaces.

## Ignored Directories

Recursive traversal skips `node_modules`, `.git`, `dist`, `out`, `.next`, `.nuxt`, and `coverage`. Symbolic links are not followed.

## Paths and Ordering

Paths are workspace-relative and use forward slashes. Multi-root exports prefix paths with deterministic workspace-folder labels to avoid collisions. Files are sorted by normalized relative path before Markdown generation.

## Output Format

The Markdown document contains a `# Code Context` title, a `## Files` section, and one section per file with a language-tagged fenced code block. Fence lengths are increased as needed to keep embedded backticks in file contents from closing the block.

The export preserves VS Code language IDs. Individual unreadable files produce a warning while the remaining files can still be exported. The untitled document remains in VS Code until the user saves or closes it.
