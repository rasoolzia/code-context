import type { ContextFile } from "../models/context-file";
import { normalizeSafeRelativePath } from "../paths/filesystem-paths";

interface MarkdownLine {
  text: string;
  start: number;
  end: number;
}

export function parseMarkdownContent(markdown: string): ContextFile[] {
  const lines = getLines(markdown);

  if (lines[0]?.text.trim().replace(/^\uFEFF/, "") !== "# Code Context") {
    throw new Error("This document is not a CodeContext export.");
  }

  const filesHeadingIndex = lines.findIndex(
    (line, index) => index > 0 && line.text.trim() === "## Files",
  );

  if (filesHeadingIndex < 0) {
    throw new Error("The CodeContext document is missing the Files section.");
  }

  const files: ContextFile[] = [];
  const seenPaths = new Set<string>();
  let lineIndex = filesHeadingIndex + 1;

  while (lineIndex < lines.length) {
    while (lineIndex < lines.length && lines[lineIndex].text.trim() === "") {
      lineIndex += 1;
    }

    if (lineIndex >= lines.length) {
      break;
    }

    const path = parsePathEntry(lines[lineIndex].text, lineIndex + 1);
    const duplicateKey = path.toLowerCase();

    if (seenPaths.has(duplicateKey)) {
      throw new Error(
        `The document contains the file path more than once: ${path}`,
      );
    }

    seenPaths.add(duplicateKey);
    lineIndex += 1;

    while (lineIndex < lines.length && lines[lineIndex].text.trim() === "") {
      lineIndex += 1;
    }

    if (lineIndex >= lines.length || isPathEntry(lines[lineIndex].text)) {
      files.push({ path, language: "", content: "" });
      continue;
    }

    const fence = parseOpeningFence(lines[lineIndex]?.text, path);
    const closingLineIndex = findClosingFence(
      lines,
      lineIndex + 1,
      fence.length,
    );

    if (closingLineIndex < 0) {
      throw new Error(`The code fence for ${path} is not closed.`);
    }

    const contentStart = lines[lineIndex].end;
    const closingLineStart = lines[closingLineIndex].start;
    const contentEnd = removeOneLineEnding(
      markdown,
      contentStart,
      closingLineStart,
    );

    files.push({
      path,
      language: fence.language,
      content: markdown.slice(contentStart, contentEnd),
    });
    lineIndex = closingLineIndex + 1;
  }

  if (files.length === 0) {
    throw new Error("The CodeContext document contains no files to import.");
  }

  return files;
}

function parsePathEntry(line: string, lineNumber: number): string {
  const trimmedLine = line.trim();
  const heading = trimmedLine.startsWith("### ")
    ? trimmedLine.slice(4).trim()
    : trimmedLine;
  const openingFenceLength = countLeadingBackticks(heading);
  let rawPath = heading;

  if (openingFenceLength > 0) {
    const closingFence = "`".repeat(openingFenceLength);

    if (!heading.endsWith(closingFence)) {
      throw new Error(
        `The file path on line ${lineNumber} has an unclosed backtick quote.`,
      );
    }

    rawPath = heading.slice(
      openingFenceLength,
      heading.length - openingFenceLength,
    );

    if (rawPath.startsWith(" ") && rawPath.endsWith(" ")) {
      rawPath = rawPath.slice(1, -1);
    }
  } else if (trimmedLine.startsWith("### ")) {
    rawPath = heading;
  }

  if (rawPath.startsWith("```") || rawPath.startsWith("## ")) {
    throw new Error(`Expected a file path on line ${lineNumber}.`);
  }

  return normalizeSafePath(rawPath, lineNumber);
}

function isPathEntry(line: string): boolean {
  const candidate = line.trim();

  return candidate !== "" && countLeadingBackticks(candidate) < 3;
}

function parseOpeningFence(
  line: string | undefined,
  path: string,
): { length: number; language: string } {
  if (!line) {
    throw new Error(`The code block for ${path} is missing.`);
  }

  const trimmedLine = line.trimStart();
  const length = countLeadingBackticks(trimmedLine);

  if (length < 3) {
    throw new Error(
      `The code block for ${path} must use a fence of at least three backticks.`,
    );
  }

  return {
    length,
    language: trimmedLine.slice(length).trim(),
  };
}

function findClosingFence(
  lines: MarkdownLine[],
  startIndex: number,
  openingFenceLength: number,
): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index].text.trimStart();
    const fenceLength = countLeadingBackticks(line);

    if (
      fenceLength >= openingFenceLength &&
      /^\s*$/.test(line.slice(fenceLength))
    ) {
      return index;
    }
  }

  return -1;
}

function normalizeSafePath(path: string, lineNumber: number): string {
  try {
    return normalizeSafeRelativePath(path);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The path is invalid.";
    throw new Error(`Invalid file path on line ${lineNumber}: ${message}`);
  }
}

function getLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;

  while (start < markdown.length) {
    let end = start;

    while (
      end < markdown.length &&
      markdown[end] !== "\n" &&
      markdown[end] !== "\r"
    ) {
      end += 1;
    }

    const text = markdown.slice(start, end);

    if (markdown[end] === "\r" && markdown[end + 1] === "\n") {
      end += 2;
    } else if (end < markdown.length) {
      end += 1;
    }

    lines.push({ text, start, end });
    start = end;
  }

  return lines;
}

function removeOneLineEnding(
  markdown: string,
  start: number,
  end: number,
): number {
  if (end <= start) {
    return end;
  }

  if (markdown[end - 1] === "\n") {
    return markdown[end - 2] === "\r" ? end - 2 : end - 1;
  }

  return markdown[end - 1] === "\r" ? end - 1 : end;
}

function countLeadingBackticks(value: string): number {
  let length = 0;

  while (value[length] === "`") {
    length += 1;
  }

  return length;
}
