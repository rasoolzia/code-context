# Project Decisions

Architectural and design decisions made during development.

---

## Route Report: framework-agnostic scanner architecture

**Decision:** Route Report uses a registry of framework-specific scanners that each implement a shared `RouteScanner` interface, rather than a single function with framework-specific branches.

**Context:** The feature needs to support Next.js and Nuxt now, and additional frameworks (React Router, Vue Router, NestJS, etc.) in the future. The command, report generator, and route model must not need to change when a new framework is added.

**Design:**

```
Command
  ↓
scanner-registry.ts  (central list of RouteScanner instances)
  ↓
RouteScanner.detect()  (framework-specific, per workspace root)
RouteScanner.scan()    (framework-specific, returns RouteEntry[])
  ↓
RouteEntry[]           (normalized, framework-agnostic model)
  ↓
generateRouteReport()  (shared Markdown generator)
```

Adding a new framework requires:

1. A new file in `src/core/routes/scanners/` implementing `RouteScanner`.
2. One line added to `src/core/routes/scanner-registry.ts`.

Nothing else changes.

**Why not a plugin system or dependency injection?** The codebase is a VS Code extension with no runtime plugin loading. A plain array of scanner objects in a central registry is the simplest structure that achieves the extensibility goal without unnecessary abstraction.

---

## Route Report: FilesystemReader abstraction

**Decision:** Scanners receive a `FilesystemReader` interface rather than calling Node.js `fs` or VS Code APIs directly.

**Context:** Scanner logic (directory traversal, route derivation) must be unit-testable without a real filesystem or a running VS Code instance.

**Design:** `FilesystemReader` exposes `readDirectory`, `readFile`, and `fileExists`. The production implementation (`vscodeFilesystemReader`) uses `vscode.workspace.fs`. Tests use an in-memory implementation built from a plain object.

This keeps the entire `src/core/routes/` layer free of VS Code dependencies, consistent with how the rest of `src/core/` is structured.

---

## Route Report: detection requires both package.json dep and routing directory

**Decision:** A framework is only detected when `package.json` contains the framework dependency AND the expected routing directory exists.

**Context:** Many projects have an `app/` or `pages/` directory for reasons unrelated to Next.js or Nuxt. Requiring the dependency prevents false positives.

**Trade-off:** A project that uses Next.js but has an unusual `package.json` location (e.g. a monorepo root without a local `package.json`) will not be detected. This is acceptable for the first version; the detection logic is isolated in each scanner's `detect()` method and can be refined independently.

---

## Route Report: package.json is read via FilesystemReader

**Decision:** The `hasNextDependency` / `hasNuxtDependency` helpers read `package.json` through the injected `FilesystemReader.readFile()` method.

**Context:** Framework detection needs both directory listings and package metadata. Keeping package reads on the injected interface lets the scanners remain independent of the real filesystem and makes detection testable with an in-memory reader.

**Trade-off:** `FilesystemReader` now includes the minimal text-reading operation required for package metadata. The scanner implementations still depend only on this small interface, not on Node.js or VS Code filesystem APIs.

---

## Route Report: source paths are workspace-relative

**Decision:** The `source` field in `RouteEntry` is relative to the workspace root.

**Example:** `app/users/[id]/page.tsx` produces the source `app/users/[id]/page.tsx`; `pages/users/[id].vue` produces `pages/users/[id].vue`.

**Context:** Workspace-relative paths are directly recognisable and can be opened from the project root. Paths use POSIX separators in the report, regardless of the host operating system.
