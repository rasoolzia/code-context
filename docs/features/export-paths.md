# Export Paths

## Purpose

Export a plain list of file paths without file contents, bullets, or tree formatting. The output opens in a native untitled plain-text document and can be edited or saved with Ctrl+S or Save As; it is not written to the workspace automatically.

## Supported Selections

Run **Export Paths** from the Explorer context menu to export one file, multiple selected files, a folder recursively, or multiple files and folders. Overlapping selections are deduplicated. With no Explorer resource, all valid files in every open workspace folder are included. Directory paths are never included.

## Paths and Ordering

Every path is relative to its workspace folder and uses forward slashes. In multi-root workspaces, paths use the same deterministic folder labels as Export Content to prevent collisions. Paths are sorted consistently and appear one per line.

## Ignored Directories

Folder traversal skips `node_modules`, `.git`, `dist`, `out`, `.next`, `.nuxt`, and `coverage`. Symbolic links are not followed.

## Output Format

The plain-text document contains a `# Export Paths` heading and a fenced `text` block containing one path per line, for example:

````markdown
# Export Paths

```text
src/app/page.tsx
src/components/Button.tsx
src/lib/utils.ts
```
````

No file contents are read or included.
