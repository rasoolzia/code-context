import type { RouteEntry, RouteType } from "../route-entry";
import type { FilesystemReader, RouteScanner } from "../route-scanner";

/**
 * Nuxt file-based routing uses the `pages/` directory.
 * Supported conventions (Nuxt 3 stable subset):
 *
 *   pages/index.vue            → /
 *   pages/about.vue            → /about
 *   pages/users/index.vue      → /users
 *   pages/users/[id].vue       → /users/[id]          (dynamic)
 *   pages/docs/[...slug].vue   → /docs/[...slug]      (catch-all)
 *
 * Nuxt 3 does not have optional catch-all in the same [[...param]] syntax
 * as Next.js; that pattern is not supported here.
 *
 * Only `.vue` files are treated as route files. `.ts`/`.js` files inside
 * pages/ are not route files in Nuxt's convention.
 */
const NUXT_ROUTE_EXTENSION = ".vue";

export const nuxtRouteScanner: RouteScanner = {
  frameworkName: "Nuxt",

  async detect(workspaceRoot, fs): Promise<boolean> {
    const hasDep = await hasNuxtDependency(workspaceRoot, fs);

    if (!hasDep) {
      return false;
    }

    return (await fs.readDirectory(join(workspaceRoot, "pages"))) !== undefined;
  },

  async scan(workspaceRoot, fs): Promise<RouteEntry[]> {
    const pagesDir = join(workspaceRoot, "pages");
    const routes: RouteEntry[] = [];

    await scanPagesDirectory(workspaceRoot, pagesDir, "", routes, fs);

    return sortRoutes(routes);
  },
};

// ── Scanner ───────────────────────────────────────────────────────────────────

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
      await scanPagesDirectory(
        workspaceRoot,
        join(currentDir, entry.name),
        `${routePrefix}/${entry.name}`,
        routes,
        fs,
      );

      continue;
    }

    if (!entry.name.endsWith(NUXT_ROUTE_EXTENSION)) {
      continue;
    }

    const base = entry.name.slice(0, -NUXT_ROUTE_EXTENSION.length);
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

async function hasNuxtDependency(
  workspaceRoot: string,
  fs: FilesystemReader,
): Promise<boolean> {
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

    return "nuxt" in deps;
  } catch {
    return false;
  }
}

function classifyRoute(route: string): RouteType {
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

  return full
    .slice(root.length)
    .replace(/^[\\/]/, "")
    .replace(/\\/g, "/");
}

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
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
