export interface ProjectTreeEntry {
  path: string;
  type: "directory" | "file";
}

interface TreeNode {
  name: string;
  isDirectory: boolean;
  children: Map<string, TreeNode>;
}

export function generateProjectTree(entries: ProjectTreeEntry[]): string {
  const roots = new Map<string, TreeNode>();

  for (const entry of entries) {
    const segments = normalizePath(entry.path);

    if (segments.length === 0) {
      continue;
    }

    let siblings = roots;

    segments.forEach((name, index) => {
      const isDirectory =
        index < segments.length - 1 || entry.type === "directory";
      let node = siblings.get(name);

      if (!node) {
        node = { name, isDirectory, children: new Map() };
        siblings.set(name, node);
      } else if (isDirectory) {
        node.isDirectory = true;
      }

      siblings = node.children;
    });
  }

  const lines = renderRoots([...roots.values()]);
  const fenceLength = Math.max(3, longestBacktickRun(lines) + 1);
  const fence = "`".repeat(fenceLength);

  return ["# Project Tree", "", `${fence}text`, ...lines, fence, ""].join("\n");
}

function renderRoots(nodes: TreeNode[]): string[] {
  return sortNodes(nodes).flatMap((node) => {
    const name = node.name.replace(/[\r\n]/g, " ");
    const label = node.isDirectory ? `${name}/` : name;

    if (!node.isDirectory || node.children.size === 0) {
      return [label];
    }

    return [label, ...renderNodes([...node.children.values()], "")];
  });
}

function renderNodes(nodes: TreeNode[], prefix: string): string[] {
  return sortNodes(nodes).flatMap((node, index, sortedNodes) => {
    const isLast = index === sortedNodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const name = node.name.replace(/[\r\n]/g, " ");
    const label = node.isDirectory ? `${name}/` : name;
    const line = `${prefix}${connector}${label}`;

    if (!node.isDirectory || node.children.size === 0) {
      return [line];
    }

    return [
      line,
      ...renderNodes(
        [...node.children.values()],
        `${prefix}${isLast ? "    " : "│   "}`,
      ),
    ];
  });
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }

    return compareText(left.name, right.name);
  });
}

function normalizePath(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
}

function longestBacktickRun(lines: string[]): number {
  return lines.reduce(
    (longest, line) =>
      Math.max(
        longest,
        ...(line.match(/`+/g) ?? [""]).map((run) => run.length),
      ),
    0,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
