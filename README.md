# CodeContext

CodeContext exports, imports, and explores project context from Visual Studio Code. Generated exports open as editable untitled documents and are not saved to the workspace unless you choose Save or Save As.

## Features

- **Export Content** creates Markdown containing selected source files or the complete workspace.
- **Export Project Tree** creates a directory tree without file contents.
- **Export Paths** creates a sorted plain-text list of workspace-relative file paths inside a `# Export Paths` text fence.
- **Import Content** imports CodeContext Markdown after validation and overwrite confirmation.
- **Import Project Tree** creates directories and empty files without changing existing files.
- **Import Paths** creates directories and empty files from a newline-separated path list.
- **Git Diff** exports staged and unstaged changes as a patch, including untracked files as additions; Explorer selections scope it to selected resources.
- **Before/After Git Context** exports complete `HEAD` and working-tree contents for changed files; Explorer selections scope it to selected resources.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

Git must be installed and available on `PATH` to use Git Diff and Before/After Git Context. The extension adds no runtime dependencies.

## Usage

Run commands from the Command Palette under the **CodeContext** category. Export Content, Export Project Tree, Export Paths, Git Diff, and Before/After Git Context open editable untitled documents. Import Content, Import Project Tree, and Import Paths share the CodeContext Import panel.

Git Diff contains changed hunks, Git metadata, and standard nearby context lines, not complete unchanged files. Before/After Git Context contains full file contents at `HEAD` and in the current working tree. Both commands include staged and unstaged changes and do not save output to the workspace automatically.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

- `myExtension.enable`: Enable/disable this extension.
- `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

- Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
- Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
- Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
