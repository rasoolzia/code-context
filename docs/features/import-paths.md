# Import Paths

## Purpose

Create filesystem structure from a newline-separated list of relative file paths. This is the **Paths → Structure** workflow and is the reverse of Export Paths; it never imports file contents.

## Command and Input Format

Run **Import Paths** to open the shared CodeContext Import panel on the **Import Paths** tab. Paste one file path per line and select **Import Paths**. Blank lines are ignored; `/` and `\\` separators are normalized. For a multi-root workspace, choose the destination workspace folder.

```text
src/app/page.tsx
src/components/Button.tsx
src/lib/utils.ts
```

## Filesystem Behavior

- Missing parent directories are created.
- Missing files are created empty.
- Existing directories are accepted.
- Existing files are left completely unchanged.
- Duplicate normalized paths are deduplicated.
- File/directory conflicts are rejected before writes.

## Security

Absolute paths, Windows drive-letter paths, null bytes, `..` traversal, paths outside the selected workspace, and symbolic-link destinations are rejected. Parent components must be directories. All writes remain inside the selected workspace folder.

## Current Limitations

- Each nonblank input line represents a file path; directory-only paths are not a separate input form.
- If a filesystem failure occurs after some entries were created, those earlier creations are not rolled back.
- Export Paths produces workspace-relative paths; these can be pasted directly into this importer.
