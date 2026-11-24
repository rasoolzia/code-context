import type { RouteEntry, RouteType } from "../route-entry";
import type { FilesystemReader, RouteScanner } from "../route-scanner";

/**
 * Recognised route entry filenames for the Next.js App Router.
 * Only these filenames produce a navigable route; all other files
 * (layout, loading, error, not-found, template, etc.) are ignored.
 */
const APP_ROUTE_FILES = new Set([
  "page.tsx",
  "page.ts",
  "page.jsx",
  "page.js",
  "page.mdx",
]);

/**
 * Next.js Pages Router: any .tsx/.ts/.jsx/.js file that is not a
 * special Next.js file produces a route.
 */
const PAGES_SPECIAL_FILES = new Set([
  "_app.tsx",
  "_app.ts",
  "_app.jsx",
  "_app.js",
  "_document.tsx",
  "_document.ts",
  "_document.jsx",
  "_document.js",
  "_error.tsx",
  "_error.ts",
  "_error.jsx",
  "_error.js",
  "404.tsx",
  "404.ts",
  "404.jsx",
  "404.js",
  "500.tsx",
  "500.ts",
  "500.jsx",
  "500.js",
]);

const PAGES_ROUTE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

export const nextRouteScanner: RouteScanner = {
  frameworkName: "Next.js",

  async detect(workspaceRoot, fs): Promise<boolean> {
    // Require next in package.json dependencies AND at least one routing dir.
    const hasDep = await hasNextDependency(workspaceRoot, fs);

    if (!hasDep) {
      return false;
    }

    const hasApp =
      (await fs.readDirectory(join(workspaceRoot, "app"))) !== undefined;
    const hasPages =
      (await fs.readDirectory(join(workspaceRoot, "pages"))) !== undefined ||
      (await fs.readDirectory(join(workspaceRoot, "src", "pages"))) !==
        undefined ||
      (await fs.readDirectory(join(workspaceRoot, "src", "app"))) !== undefined;

    return hasApp || hasPages;
  },

  async scan(workspaceRoot, fs): Promise<RouteEntry[]> {
    const routes: RouteEntry[] = [];

    // App Router: prefer src/app over app
    const appDirs = [
      join(workspaceRoot, "src", "app"),
      join(workspaceRoot, "app"),
    ];

    for (const appDir of appDirs) {
      if ((await fs.readDirectory(appDir)) !== undefined) {
        await scanAppDirectory(workspaceRoot, appDir, "", routes, fs);
        break;
      }
    }

    // Pages Router: prefer src/pages over pages
    const pagesDirs = [
      join(workspaceRoot, "src", "pages"),
      join(workspaceRoot, "pages"),
    ];

    for (const pagesDir of pagesDirs) {
      if ((await fs.readDirectory(pagesDir)) !== undefined) {
        await scanPagesDirectory(workspaceRoot, pagesDir, "", routes, fs);
        break;
      }
    }

    return sortRoutes(routes);
  },
};

// ── App Router ────────────────────────────────────────────────────────────────

async function scanAppDirectory(
  workspaceRoot: string,
  currentDir: string,
  routePrefix: string,
  routes: RouteEntry[],
  fs: FilesystemReader,
): Promise<void> {
  const entries = await fs.readDirectory(currentDir);

  if (!entries) {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory) {
      if (APP_ROUTE_FILES.has(entry.name)) {
        const source = toRelativePosix(workspaceRoot, currentDir, entry.name);
        const route = routePrefix === "" ? "/" : routePrefix;
        routes.push({ route, source, type: classifyRoute(route) });
      }

      continue;
    }

    const segment = entry.name;

    // Route groups: (group) — transparent to the URL
    if (segment.startsWith("(") && segment.endsWith(")")) {
      await scanAppDirectory(
        workspaceRoot,
        join(currentDir, segment),
        routePrefix,
        routes,
        fs,
      );
      continue;
    }

    // Private folders: _folder — excluded from routing
    if (segment.startsWith("_")) {
      continue;
    }

    // Parallel routes: @slot — excluded from URL segments
    if (segment.startsWith("@")) {
      continue;
    }

    // Intercepting routes: (.)seg, (..)seg, (...)seg — skip for now
    // These are advanced patterns not yet supported; documented in limitations.
    if (/^\(\.+\)/.test(segment)) {
      continue;
    }

    const urlSegment = segment;
    const nextPrefix = `${routePrefix}/${urlSegment}`;

    await scanAppDirectory(
      workspaceRoot,
      join(currentDir, segment),
      nextPrefix,
      routes,
      fs,
    );
  }
}

// ── Pages Router ─────────────────────────────────────────────────────────────

async function scanPagesDirectory(
  workspaceRoot: string,
  currentDir: string,
  routePrefix: string,
  routes: RouteEntry[],
  fs: FilesystemReader,
): Promise<void> {
  const entries = await fs.readDirectory(currentDir);

  if (!entries) {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      // _private folders are excluded from Pages Router routing too
      if (entry.name.startsWith("_")) {
        continue;
      }

      await scanPagesDirectory(
        workspaceRoot,
        join(currentDir, entry.name),
        `${routePrefix}/${entry.name}`,
        routes,
        fs,
      );

      continue;
    }

    const dotIndex = entry.name.lastIndexOf(".");
    const ext = dotIndex >= 0 ? entry.name.slice(dotIndex) : "";
    const base = dotIndex >= 0 ? entry.name.slice(0, dotIndex) : entry.name;

    if (!PAGES_ROUTE_EXTENSIONS.has(ext)) {
      continue;
    }

    if (PAGES_SPECIAL_FILES.has(entry.name)) {
      continue;
    }

    const source = toRelativePosix(workspaceRoot, currentDir, entry.name);
    const route =
      base === "index"
        ? routePrefix === ""
          ? "/"
          : routePrefix
        : `${routePrefix}/${base}`;

    routes.push({ route, source, type: classifyRoute(route) });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hasNextDependency(
  workspaceRoot: string,
  fs: FilesystemReader,
): Promise<boolean> {
  // Check package.json at the workspace root only.
  // We do not walk up; monorepo sub-packages are detected when their own
  // workspace root is passed in.
  const pkgPath = join(workspaceRoot, "package.json");
  const content = await fs.readFile(pkgPath);

  if (content === undefined) {
    return false;
  }

  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = {
      ...(pkg["dependencies"] as Record<string, unknown> | undefined),
      ...(pkg["devDependencies"] as Record<string, unknown> | undefined),
      ...(pkg["peerDependencies"] as Record<string, unknown> | undefined),
    };

    return "next" in deps;
  } catch {
    return false;
  }
}

function classifyRoute(route: string): RouteType {
  if (route.includes("[[...")) {
    return "optional-catch-all";
  }

  if (route.includes("[...")) {
    return "catch-all";
  }

  if (route.includes("[")) {
    return "dynamic";
  }

  return "static";
}

function toRelativePosix(
  root: string,
  directory: string,
  filename: string,
): string {
  const full = join(directory, filename);
  // root ends without separator; strip leading separator from relative part
  return full
    .slice(root.length)
    .replace(/^[\\/]/, "")
    .replace(/\\/g, "/");
}

function join(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/\\/g, "/"))
    .join("/")
    .replace(/\/+/g, "/");
}

function sortRoutes(routes: RouteEntry[]): RouteEntry[] {
  return [...routes].sort(
    (left, right) =>
      compareText(left.route, right.route) ||
      compareText(left.source, right.source),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
