# Before/After Git Context

## Purpose

Export complete file contents from before and after Git changes for use as AI context. Unlike Git Diff, this feature includes unchanged lines from each changed file. The result opens as an editable untitled Markdown document and is not written to the workspace automatically.

## Command and Workflow

Run **CodeContext: Before/After Git Context** from the Command Palette to include changes from all Git repositories containing open workspace folders. From an Explorer context menu, select one or more files or folders to scope the context to changed paths beneath that selection. Overlapping selections are deduplicated, and a selected unchanged file contributes no section. Without a selection, the command remains workspace-wide. The result opens as an editable untitled Markdown document. No workspace, non-Git workspaces, Git errors, and no relevant changes are reported clearly.

## Before and After

- **Before** is the complete file content at `HEAD`.
- **After** is the complete current working-tree content, including both staged and unstaged changes.
- **Untracked files** have an empty Before section and their complete current contents in After.
- **Deleted files** include their complete `HEAD` content in Before and an empty After section.
- **Renamed files** use the Git-reported old path for Before and the new path for After, with rename metadata in the output.
- **Binary files and symbolic links** are identified, but their bytes are not embedded.

All changed files are ordered deterministically. Markdown code fences are lengthened when necessary so source content containing backticks remains intact.

## Requirements and Limitations

- Git must be installed and available on `PATH`.
- The workspace must be inside one or more Git repositories.
- The initial comparison reference is `HEAD`; comparison to another commit or branch is not currently configurable.
- Each discovered repository is included. Multiple repositories can contain the same relative path, so the Markdown sections may have identical paths.
- If a file cannot be read, the export reports the failure instead of silently omitting it.
