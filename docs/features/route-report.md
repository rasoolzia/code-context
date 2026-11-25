# Route Report

Route Report analyzes the workspace structure and generates a Markdown report describing the application routes for supported web frameworks.

The report is structural metadata derived entirely from the filesystem. No application source code is read or executed.

## Supported Frameworks

- **Next.js** — App Router and Pages Router
- **Nuxt** — `pages/` and `app/pages/` directory conventions

## How Framework Detection Works

When the command runs, CodeContext checks each workspace folder for a supported framework by:

1. Reading `package.json` at the workspace root and checking for a known framework dependency (`next` or `nuxt`).
2. Confirming that the expected routing directory exists (`app/` or `pages/` for Next.js; `app/pages/` or `pages/` for Nuxt).

Both conditions must be true. A project that has an `app/` directory but no `next` dependency is not classified as a Next.js project.

Detection is conservative and does not walk up the directory tree. In a monorepo, each workspace folder is evaluated independently.

## Supported Routing Conventions

### Next.js — App Router

Scans the `app/` directory (or `src/app/`).

Only files named `page.tsx`, `page.ts`, `page.jsx`, `page.js`, or `page.mdx` produce route entries. All other files (`layout`, `loading`, `error`, `not-found`, `template`, etc.) are ignored.

| Pattern             | Example source                   | Route               |
| ------------------- | -------------------------------- | ------------------- |
| Root                | `app/page.tsx`                   | `/`                 |
| Static segment      | `app/about/page.tsx`             | `/about`            |
| Dynamic segment     | `app/users/[id]/page.tsx`        | `/users/[id]`       |
| Catch-all           | `app/docs/[...slug]/page.tsx`    | `/docs/[...slug]`   |
| Optional catch-all  | `app/shop/[[...slug]]/page.tsx`  | `/shop/[[...slug]]` |
| Route group         | `app/(marketing)/about/page.tsx` | `/about`            |
| Private folder      | `app/_components/`               | _(excluded)_        |
| Parallel route slot | `app/@modal/`                    | _(excluded)_        |

Route groups `(group)` are transparent to the URL. Private folders `_folder` and parallel route slots `@slot` are excluded. Intercepting routes `(.)`, `(..)`, `(...)` are not yet supported and are skipped.

### Next.js — Pages Router

Scans the `pages/` directory (or `src/pages/`).

Any `.tsx`, `.ts`, `.jsx`, or `.js` file that is not a Next.js special file produces a route. Special files excluded: `_app`, `_document`, `_error`, `404`, `500`.

| Pattern      | Example source          | Route         |
| ------------ | ----------------------- | ------------- |
| Root         | `pages/index.tsx`       | `/`           |
| Static       | `pages/about.tsx`       | `/about`      |
| Nested index | `pages/users/index.tsx` | `/users`      |
| Dynamic      | `pages/users/[id].tsx`  | `/users/[id]` |

### Nuxt — pages/ conventions

Scans `app/pages/` first, then `pages/`. If both directories exist, `app/pages/` takes precedence. Only `.vue` files produce route entries.

| Pattern      | Example source             | Route             |
| ------------ | -------------------------- | ----------------- |
| Root         | `pages/index.vue`          | `/`               |
| Static       | `pages/about.vue`          | `/about`          |
| Nested index | `pages/users/index.vue`    | `/users`          |
| Dynamic      | `pages/users/[id].vue`     | `/users/[id]`     |
| Catch-all    | `pages/docs/[...slug].vue` | `/docs/[...slug]` |

Nuxt 4-style routes use the same conventions under `app/pages/`, for example `app/pages/about.vue` produces `/about`.

## Output Example

```markdown
# Route Report

## Routes

### `/`

- **Type:** static
- **Source:** `app/page.tsx`

### `/users/[id]`

- **Type:** dynamic
- **Source:** `app/users/[id]/page.tsx`

## Route Table

| Route         | Type    | Source                    |
| ------------- | ------- | ------------------------- |
| `/`           | static  | `app/page.tsx`            |
| `/users/[id]` | dynamic | `app/users/[id]/page.tsx` |
```

Route Report opens an editable untitled Markdown document. Route Report Preview opens that same report in VS Code's built-in Markdown preview. Nothing is written to the workspace. When no routes are found, the report shows `*No routes found.*` instead of an empty table.

## Multi-Root Workspaces

Route Report evaluates each workspace folder independently.

- If exactly one supported framework is found across all folders, the report is generated immediately.
- If multiple frameworks or folders are detected, a picker lets you choose which one to report on.
- If no supported framework is found in any folder, an informative message is shown.

## Usage

Run **CodeContext: Route Report** to open an editable Markdown document, or **CodeContext: Route Report Preview** to open the same report in VS Code's built-in Markdown preview. Route Report is also available from the Explorer context menu.

No configuration is required. The framework is detected automatically.

## Limitations

- **Next.js intercepting routes** (`(.)`, `(..)`, `(...)`) are not supported and are silently skipped.
- **Nuxt optional catch-all** (`[[...param]]`) is not a standard Nuxt 3 convention and is not supported.
- **Nuxt named routes** and `definePageMeta` customisations are not read; routes are derived from the filesystem only.
- **API routes** (`app/api/`, `pages/api/`) are included in the scan because they follow the same file conventions. They can be identified by their source path.
- **Monorepo sub-packages** are detected only when their directory is an open workspace folder.
- Very deeply nested or unusually large route trees may take a moment to scan.

## Adding Future Framework Support

To add a new framework scanner:

1. Create a file in `src/core/routes/scanners/` that exports an object implementing the `RouteScanner` interface (`detect` + `scan`).
2. Add it to the `routeScanners` array in `src/core/routes/scanner-registry.ts`.

No other files need to change. The command, report generator, and route model are all framework-agnostic.
