import type { FilesystemEntry } from "../models/filesystem-entry";
import {
  normalizeFilesystemEntries,
  normalizeSafeRelativePath,
} from "../paths/filesystem-paths";

interface ParsedTreeLine {
  depth: number;
  label: string;
}

export function parseProjectTree(input: string): FilesystemEntry[] {
  const lines = input.split(/\r\n|\n|\r/);
  const baseIndent = getBaseIndent(lines);
  const indentWidth = getIndentWidth(lines, baseIndent);
  const entries = new Map<string, FilesystemEntry>();
  const directoryStack: string[] = [];
  let contentStarted = false;

  for (const originalLine of lines) {
    const line = removeIndentColumns(originalLine, baseIndent).trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (!contentStarted && trimmed === "# Project Tree") {
      continue;
    }

    if (!contentStarted && isFenceLine(trimmed)) {
      contentStarted = true;
      continue;
    }

    if (contentStarted && isFenceLine(trimmed)) {
      continue;
    }

    contentStarted = true;
    const parsed = parseTreeLine(line, indentWidth);

    if (parsed.depth > directoryStack.length) {
      throw new Error(`The tree has a missing parent before: ${parsed.label}`);
    }

    const parentPath =
      parsed.depth > 0 ? directoryStack[parsed.depth - 1] : undefined;

    if (parentPath) {
      entries.set(parentPath.toLowerCase(), {
        path: parentPath,
        type: "directory",
      });
    }

    const isDirectory =
      parsed.label.endsWith("/") || parsed.label.endsWith("\\");
    const label = isDirectory ? parsed.label.slice(0, -1) : parsed.label;
    const normalizedLabel = normalizeSafeRelativePath(label);
    const path = parentPath
      ? normalizeSafeRelativePath(`${parentPath}/${normalizedLabel}`)
      : normalizedLabel;
    const entry: FilesystemEntry = {
      path,
      type: isDirectory ? "directory" : "file",
    };

    const existing = entries.get(path.toLowerCase());

    if (existing && existing.type !== entry.type) {
      throw new Error(`The tree path is both a file and a directory: ${path}`);
    }

    entries.set(path.toLowerCase(), entry);
    directoryStack.length = parsed.depth;
    directoryStack[parsed.depth] = path;
  }

  if (entries.size === 0) {
    throw new Error("Enter a project tree to import.");
  }

  return normalizeFilesystemEntries([...entries.values()]);
}

function parseTreeLine(line: string, indentWidth: number): ParsedTreeLine {
  const branchPattern =
    /^((?:(?:│   )|(?:\|   )|(?:    ))*)(?:├──|└──|\|--|\+--|`--|\\--)\s*(.+)$/;
  const branch = line.match(branchPattern);

  if (branch) {
    return {
      depth: branch[1].length / 4 + 1,
      label: branch[2].trim(),
    };
  }

  const indentation = line.match(/^[\t ]*/)?.[0] ?? "";
  const depth = Math.floor(
    indentation.replace(/\t/g, "  ").length / indentWidth,
  );
  const rootLabel = line
    .slice(indentation.length)
    .trim()
    .replace(/^[-*+]\s+/, "");

  if (!rootLabel || /^`{3,}/.test(rootLabel)) {
    throw new Error(`Unable to interpret tree entry: ${line.trim()}`);
  }

  return { depth, label: rootLabel };
}

function getBaseIndent(lines: string[]): number {
  const indentations = lines.flatMap((line) => {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed === "# Project Tree" ||
      isFenceLine(trimmed) ||
      /(?:├──|└──|\|--|\+--|`--|\\--)/.test(line)
    ) {
      return [];
    }

    return [line.match(/^[\t ]*/)?.[0].replace(/\t/g, "  ").length ?? 0];
  });

  return indentations.length > 0 ? Math.min(...indentations) : 0;
}

function getIndentWidth(lines: string[], baseIndent: number): number {
  const indentations = lines.flatMap((line) => {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed === "# Project Tree" ||
      isFenceLine(trimmed) ||
      /(?:├──|└──|\|--|\+--|`--|\\--)/.test(line)
    ) {
      return [];
    }

    const indent = line.match(/^[\t ]*/)?.[0].replace(/\t/g, "  ").length ?? 0;
    const relativeIndent = indent - baseIndent;

    return relativeIndent > 0 ? [relativeIndent] : [];
  });

  return indentations.length > 0 ? Math.min(...indentations) : 2;
}

function removeIndentColumns(line: string, columns: number): string {
  let index = 0;
  let removedColumns = 0;

  while (
    removedColumns < columns &&
    (line[index] === " " || line[index] === "\t")
  ) {
    removedColumns += line[index] === "\t" ? 2 : 1;
    index += 1;
  }

  return line.slice(index);
}

function isFenceLine(line: string): boolean {
  return /^`{3,}(?:text)?\s*$/i.test(line);
}
