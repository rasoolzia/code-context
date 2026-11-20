import { getSafeCodeFence } from "./markdown/code-fence";

export interface GitFileContext {
  path: string;
  oldPath?: string;
  status: string;
  before: string;
  after: string;
  beforeBinary: boolean;
  afterBinary: boolean;
}

export function generateBeforeAfterGitContext(
  files: readonly GitFileContext[],
): string {
  const sortedFiles = [...files].sort((left, right) =>
    compareText(left.path, right.path),
  );
  const sections = sortedFiles.map((file) => {
    const titlePath = escapeInlinePath(file.path);
    const beforePath = file.oldPath ?? file.path;
    const before = file.beforeBinary ? "[Binary content omitted]" : file.before;
    const after = file.afterBinary ? "[Binary content omitted]" : file.after;

    return [
      `## ${titlePath}`,
      "",
      `Status: ${file.status.trim() || "modified"}`,
      ...(file.oldPath && file.oldPath !== file.path
        ? [`Renamed from: ${escapeInlinePath(file.oldPath)}`, ""]
        : [""]),
      `### Before (${escapeInlinePath(beforePath)} at HEAD)`,
      "",
      fencedContent(before, languageFromPath(beforePath)),
      "",
      `### After (${escapeInlinePath(file.path)} in working tree)`,
      "",
      fencedContent(after, languageFromPath(file.path)),
    ].join("\n");
  });

  return ["# Before/After Git Context", "", ...sections, ""].join("\n");
}

export function generateGitDiffOutput(diff: string): string {
  return diff;
}

function fencedContent(content: string, language: string): string {
  const fence = getSafeCodeFence(content);
  const safeLanguage = language.replace(/[\r\n`]/g, "");

  return [`${fence}${safeLanguage}`, content, fence].join("\n");
}

function escapeInlinePath(path: string): string {
  const fence = "`".repeat(
    Math.max(
      1,
      (path.match(/`+/g) ?? []).reduce(
        (longest, run) => Math.max(longest, run.length),
        0,
      ) + 1,
    ),
  );
  const normalizedPath = path.replace(/[\r\n]/g, " ");

  return `${fence}${/^[ `]|[ `]$/.test(normalizedPath) ? ` ${normalizedPath} ` : normalizedPath}${fence}`;
}

function languageFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "c",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    py: "python",
    rs: "rust",
    sh: "bash",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    txt: "text",
    yaml: "yaml",
    yml: "yaml",
  };

  return extension ? (languages[extension] ?? "text") : "text";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
