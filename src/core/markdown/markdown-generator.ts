import type { ContextFile } from "../models/context-file";
import { getSafeCodeFence } from "./code-fence";

export function generateMarkdown(files: ContextFile[]): string {
  const sortedFiles = [...files].sort((left, right) => {
    const pathOrder = compareText(
      normalizePath(left.path),
      normalizePath(right.path),
    );

    return pathOrder || compareText(left.content, right.content);
  });

  const sections = sortedFiles.map((file) => {
    const codeFence = getSafeCodeFence(file.content);
    const pathFence = "`".repeat(
      Math.max(1, longestBacktickRun(file.path) + 1),
    );
    const escapedPath = file.path.replace(/[\r\n]/g, " ");
    const pathContent = /^[ `]|[ `]$/.test(escapedPath)
      ? ` ${escapedPath} `
      : escapedPath;
    const language = file.language.replace(/[\r\n`]/g, "");

    return [
      `### ${pathFence}${pathContent}${pathFence}`,
      "",
      `${codeFence}${language}`,
      file.content,
      codeFence,
    ].join("\n");
  });

  return ["# Code Context", "", "## Files", "", ...sections, ""].join("\n");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

function longestBacktickRun(value: string): number {
  return (value.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
