import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const maximumBuffer = 64 * 1024 * 1024;

export interface GitRepository {
  root: string;
}

export interface ChangedGitFile {
  status: string;
  path: string;
  oldPath?: string;
  untracked: boolean;
}

export interface GitFileContent {
  content: string;
  binary: boolean;
  missing: boolean;
}

export interface ChangedGitRepository {
  repository: GitRepository;
  files: ChangedGitFile[];
}

export class GitCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitCommandError";
  }
}

export class GitRepositoryNotFoundError extends Error {
  constructor() {
    super("The current workspace is not inside a Git repository.");
    this.name = "GitRepositoryNotFoundError";
  }
}

export async function findGitRepositories(
  workspacePaths: readonly string[],
): Promise<GitRepository[]> {
  const repositories = new Map<string, GitRepository>();

  for (const workspacePath of workspacePaths) {
    const result = await runGit(
      workspacePath,
      ["rev-parse", "--show-toplevel"],
      true,
    );

    if (result === undefined) {
      continue;
    }

    const root = path.resolve(result.trim());
    repositories.set(normalizeRepositoryPath(root), { root });
  }

  if (repositories.size === 0) {
    throw new GitRepositoryNotFoundError();
  }

  return [...repositories.values()].sort((left, right) =>
    compareText(
      normalizeRepositoryPath(left.root),
      normalizeRepositoryPath(right.root),
    ),
  );
}

export async function getChangedGitFiles(
  repository: GitRepository,
): Promise<ChangedGitFile[]> {
  const output = await runGitRequired(repository.root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--renames",
  ]);
  const fields = output.split("\0");
  const changes: ChangedGitFile[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];

    if (record.length < 4) {
      continue;
    }

    const status = record.slice(0, 2);
    const filePath = normalizeGitPath(record.slice(3));
    const isRename = status.includes("R") || status.includes("C");
    const oldPath = isRename
      ? normalizeGitPath(fields[++index] ?? "")
      : undefined;

    if (
      !isSafeRepositoryPath(repository.root, filePath) ||
      (oldPath && !isSafeRepositoryPath(repository.root, oldPath))
    ) {
      throw new GitCommandError("Git returned a path outside the repository.");
    }

    changes.push({
      status,
      path: filePath,
      oldPath,
      untracked: status === "??",
    });
  }

  return changes.sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.status, right.status),
  );
}

export async function collectChangedGitRepositories(
  workspacePaths: readonly string[],
  selectedResourcePaths: readonly string[] = [],
): Promise<ChangedGitRepository[]> {
  const repositories = await findGitRepositories(workspacePaths);
  const results: ChangedGitRepository[] = [];

  for (const repository of repositories) {
    const changedFiles = await getChangedGitFiles(repository);
    const files =
      selectedResourcePaths.length > 0
        ? changedFiles.filter((changedFile) =>
            isSelectedGitChange(
              repository.root,
              changedFile,
              selectedResourcePaths,
            ),
          )
        : changedFiles;

    results.push({ repository, files });
  }

  return results;
}

function isSelectedGitChange(
  repositoryRoot: string,
  change: ChangedGitFile,
  selectedResourcePaths: readonly string[],
): boolean {
  return selectedResourcePaths.some((selectedPath) => {
    const relativeSelection = path.relative(
      repositoryRoot,
      path.resolve(selectedPath),
    );

    if (
      relativeSelection === ".." ||
      relativeSelection.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeSelection)
    ) {
      return false;
    }

    let selection = normalizeGitPath(relativeSelection).replace(/\/$/, "");

    if (!selection || selection === ".") {
      return true;
    }

    let selectionPathKey = selection;
    let changedPaths = [change.path, change.oldPath].filter(
      (filePath): filePath is string => filePath !== undefined,
    );

    if (process.platform === "win32") {
      selectionPathKey = selectionPathKey.toLowerCase();
      changedPaths = changedPaths.map((filePath) => filePath.toLowerCase());
    }

    return changedPaths.some(
      (filePath) =>
        filePath === selectionPathKey ||
        filePath.startsWith(`${selectionPathKey}/`),
    );
  });
}

export async function getGitDiff(
  repository: GitRepository,
  changes: readonly ChangedGitFile[],
): Promise<string> {
  const trackedChanges = changes.filter((change) => !change.untracked);
  let trackedDiff = "";

  if (trackedChanges.length > 0) {
    const changedPathspecs = [
      ...new Set(
        trackedChanges.flatMap((change) =>
          change.oldPath ? [change.oldPath, change.path] : [change.path],
        ),
      ),
    ];
    const hasHead =
      (await runGit(
        repository.root,
        ["rev-parse", "--verify", "HEAD"],
        true,
      )) !== undefined;
    const diffArgs = hasHead
      ? [
          "diff",
          "HEAD",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--find-renames",
          "--",
          ...changedPathspecs,
        ]
      : [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--find-renames",
          "--",
          ...changedPathspecs,
        ];
    trackedDiff = await runGitRequired(repository.root, diffArgs);

    if (!hasHead) {
      const unstagedDiff = await runGitRequired(repository.root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--",
        ...changedPathspecs,
      ]);
      trackedDiff = [trackedDiff, unstagedDiff].filter(Boolean).join("\n");
    }
  }

  const untrackedDiffs: string[] = [];

  for (const change of changes.filter((candidate) => candidate.untracked)) {
    const file = await getWorkingGitFile(repository, change.path);
    untrackedDiffs.push(formatUntrackedDiff(change.path, file));
  }

  return [trackedDiff, ...untrackedDiffs].filter(Boolean).join("\n");
}

export async function getGitFileAtHead(
  repository: GitRepository,
  filePath: string,
): Promise<GitFileContent> {
  if (!isSafeRepositoryPath(repository.root, filePath)) {
    throw new GitCommandError("Git returned a path outside the repository.");
  }

  const hasHead =
    (await runGit(repository.root, ["rev-parse", "--verify", "HEAD"], true)) !==
    undefined;

  if (!hasHead) {
    return { content: "", binary: false, missing: true };
  }

  const result = await runGitBuffer(
    repository.root,
    ["show", `HEAD:${toGitPath(filePath)}`],
    true,
  );

  if (result === undefined) {
    return { content: "", binary: false, missing: true };
  }

  return decodeContent(result);
}

export async function getWorkingGitFile(
  repository: GitRepository,
  filePath: string,
): Promise<GitFileContent> {
  if (!isSafeRepositoryPath(repository.root, filePath)) {
    throw new GitCommandError("Git returned a path outside the repository.");
  }

  const absolutePath = path.resolve(
    repository.root,
    ...toGitPath(filePath).split("/"),
  );

  try {
    const segments = toGitPath(filePath).split("/");
    let currentPath = repository.root;

    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);
      const stat = await fs.lstat(currentPath);

      if (stat.isSymbolicLink()) {
        if (index === segments.length - 1) {
          return { content: "", binary: true, missing: false };
        }

        throw new GitCommandError(
          `Refusing to read ${filePath} through a symbolic-link directory.`,
        );
      }

      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new GitCommandError(
          `Unable to read ${filePath}: a parent path is not a directory.`,
        );
      }
    }

    return decodeContent(await fs.readFile(absolutePath));
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw error;
    }

    if (isNotFound(error)) {
      return { content: "", binary: false, missing: true };
    }

    throw new GitCommandError(
      `Unable to read ${filePath} from the working tree.`,
    );
  }
}

function formatUntrackedDiff(filePath: string, file: GitFileContent): string {
  const quotedPath = quoteGitPath(toGitPath(filePath));
  const header = [
    `diff --git a/${quotedPath} b/${quotedPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${quotedPath}`,
  ];

  if (file.binary) {
    return [
      ...header,
      "Binary files /dev/null and the working-tree file differ",
    ].join("\n");
  }

  const lines = splitContentLines(file.content);

  if (lines.length === 0) {
    return header.join("\n");
  }

  header.push(`@@ -0,0 +1,${lines.length} @@`);
  header.push(...lines.map((line) => `+${line}`));

  if (!file.content.endsWith("\n")) {
    header.push("\\ No newline at end of file");
  }

  return header.join("\n");
}

function decodeContent(buffer: Buffer): GitFileContent {
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      binary: buffer.includes(0),
      missing: false,
    };
  } catch {
    return { content: "", binary: true, missing: false };
  }
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.map((line) => line.replace(/\r$/, ""));
}

function quoteGitPath(filePath: string): string {
  return /[\s"\\]/.test(filePath) ? JSON.stringify(filePath) : filePath;
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function toGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isSafeRepositoryPath(
  repositoryRoot: string,
  filePath: string,
): boolean {
  if (!filePath || filePath.includes("\0") || path.isAbsolute(filePath)) {
    return false;
  }

  const resolvedPath = path.resolve(
    repositoryRoot,
    ...toGitPath(filePath).split("/"),
  );
  const relativePath = path.relative(repositoryRoot, resolvedPath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

async function runGit(
  cwd: string,
  args: string[],
  allowFailure = false,
): Promise<string | undefined> {
  const result = await runGitBuffer(cwd, args, allowFailure);

  return result?.toString("utf8");
}

async function runGitRequired(cwd: string, args: string[]): Promise<string> {
  const output = await runGit(cwd, args);

  if (output === undefined) {
    throw new GitCommandError("A required Git command returned no output.");
  }

  return output;
}

async function runGitBuffer(
  cwd: string,
  args: string[],
  allowFailure = false,
): Promise<Buffer | undefined> {
  try {
    const { stdout } = await executeFile("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: maximumBuffer,
      encoding: "buffer",
    });

    return stdout;
  } catch (error) {
    const processError = error as NodeJS.ErrnoException & {
      stderr?: Buffer | string;
      code?: string | number;
    };

    if (processError.code === "ENOENT") {
      throw new GitCommandError(
        "Git executable was not found. Install Git and ensure it is on PATH.",
      );
    }

    const stderr = processError.stderr?.toString().trim();

    if (allowFailure && isExpectedGitFailure(args, stderr ?? "")) {
      return undefined;
    }

    throw new GitCommandError(stderr || "A Git command failed.");
  }
}

function isExpectedGitFailure(args: string[], stderr: string): boolean {
  if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
    return stderr.includes("not a git repository");
  }

  if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD") {
    return /Needed a single revision|unknown revision|ambiguous argument/i.test(
      stderr,
    );
  }

  if (args[0] === "show" && args[1]?.startsWith("HEAD:")) {
    return /does not exist in|exists on disk, but not in/i.test(stderr);
  }

  return false;
}

function normalizeRepositoryPath(repositoryPath: string): string {
  const resolvedPath = path.resolve(repositoryPath);

  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
