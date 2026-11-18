# Export Project Tree

## Purpose

Export a project structure as a virtual Markdown tree without reading file contents.

## Supported Selections

Run **CodeContext: Export Project Tree** from the Explorer context menu to export a selected file, multiple selected files and folders, or a selected folder recursively. Selected files appear as roots by filename; selected folders appear as roots by folder name, with descendants beneath them. Overlapping selections are deduplicated. With no Explorer resource, the command exports the whole open workspace.

## Ignored Directories

Traversal skips `node_modules`, `.git`, `dist`, `out`, `.next`, `.nuxt`, and `coverage`. Symbolic links are skipped to avoid cycles.

## Paths and Ordering

Selected resources are rendered relative to their selected roots, without workspace-parent directories. Whole-workspace output uses workspace-relative paths. Multi-root workspace exports use deterministic workspace-folder labels to distinguish matching paths. Directory and file ordering is deterministic; directories are listed before files at each level. Empty directories are retained.

## Output Format

The virtual `code-context:` document starts with `# Project Tree` and contains a fenced `text` block with a Unicode branch tree. No source file contents are included.
