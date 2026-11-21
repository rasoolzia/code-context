# Git Diff

## Purpose

Export Git changes as a patch containing change metadata and changed hunks, including Git's normal nearby context lines. Complete unchanged files are never included. The result opens as an editable untitled plain-text document; it is not written to the workspace automatically.

The output begins with `# Git Diff`, followed by the existing Git patch unchanged and without an enclosing code fence.

## Command and Workflow

Run **CodeContext: Git Diff** from the Command Palette to inspect all Git repositories containing open workspace folders. From an Explorer context menu, select one or more files or folders to scope the diff to changes at those paths. Folder selections include changed descendants; overlapping selections are deduplicated. Without a selection, the command remains workspace-wide. The result opens as an editable untitled plain-text document. If no workspace is open, no repository is found, or no relevant changes exist, CodeContext reports that state instead of opening an empty export.

## Change Coverage

Tracked staged and unstaged changes are compared against `HEAD`, representing the current combined working-tree result. In an unborn repository, staged and unstaged diffs are collected separately. Untracked text files are represented as new-file unified diffs with all file lines added. Deleted files and Git-reported renames retain Git's diff metadata. Results and untracked additions are ordered deterministically.

Git's diff output includes binary-file metadata when a tracked binary file changes. Untracked binary files are represented as binary additions without embedding their bytes.

## Requirements and Limitations

- Git must be installed and available on `PATH`.
- The workspace must be inside one or more Git repositories.
- The output is the Git CLI's patch representation for tracked changes; external diff drivers and text conversion are disabled.
- Untracked-file patches are synthesized because untracked files have no normal Git diff. They contain added lines and new-file headers; binary data is omitted.
- Multi-root workspaces combine repository patches. Git-relative paths can repeat when separate repositories contain identically named files.
