export type RouteType =
  | "static"
  | "dynamic"
  | "catch-all"
  | "optional-catch-all";

export interface RouteEntry {
  /** Normalized route path, e.g. `/users/[id]` */
  route: string;
  /** Workspace-relative source file, e.g. `app/users/[id]/page.tsx` */
  source: string;
  type: RouteType;
}
