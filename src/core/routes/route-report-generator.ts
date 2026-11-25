import type { RouteEntry } from "./route-entry";

/**
 * Generates a deterministic Markdown route report.
 *
 * Each route is shown in readable Markdown and in a structured table.
 */
export function generateRouteReport(routes: RouteEntry[]): string {
  const orderedRoutes = [...routes].sort(
    (left, right) =>
      compareText(left.route, right.route) ||
      compareText(left.source, right.source),
  );

  const routeSections = orderedRoutes.flatMap((entry) => [
    `### \`${entry.route}\``,
    "",
    `- **Type:** ${entry.type}`,
    `- **Source:** \`${entry.source}\``,
    "",
  ]);
  const tableRows = orderedRoutes.map(
    (entry) =>
      `| \`${escapeCell(entry.route)}\` | ${entry.type} | \`${escapeCell(entry.source)}\` |`,
  );

  return [
    "# Route Report",
    "",
    "## Routes",
    "",
    ...(orderedRoutes.length === 0
      ? ["*No routes found.*", ""]
      : [
          ...routeSections,
          "## Route Table",
          "",
          "| Route | Type | Source |",
          "| --- | --- | --- |",
          ...tableRows,
        ]),
    "",
  ].join("\n");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Escape pipe characters inside a Markdown table cell. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}
