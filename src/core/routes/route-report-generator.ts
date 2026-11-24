import type { RouteEntry } from "./route-entry";

/**
 * Generates a deterministic Markdown route report.
 *
 * The report is intentionally concise and AI-friendly: a header section
 * identifies the framework, and a table lists every route with its source
 * file and type.
 */
export function generateRouteReport(
  frameworkName: string,
  routes: RouteEntry[],
): string {
  const rows = routes.map((entry) =>
    `| \`${escapeCell(entry.route)}\` | \`${escapeCell(entry.source)}\` | ${formatType(entry.type)} |`,
  );

  const table = [
    "| Route | Source | Type |",
    "| --- | --- | --- |",
    ...rows,
  ];

  const body =
    routes.length === 0
      ? ["*No routes found.*"]
      : table;

  return [
    "# Route Report",
    "",
    "## Framework",
    "",
    frameworkName,
    "",
    "## Routes",
    "",
    ...body,
    "",
  ].join("\n");
}

function formatType(type: RouteEntry["type"]): string {
  switch (type) {
    case "static":
      return "Static";
    case "dynamic":
      return "Dynamic";
    case "catch-all":
      return "Catch-all";
    case "optional-catch-all":
      return "Optional catch-all";
  }
}

/** Escape pipe characters inside a Markdown table cell. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
