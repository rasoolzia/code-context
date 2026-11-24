import type { RouteScanner } from "./route-scanner";
import { nextRouteScanner } from "./scanners/next-route-scanner";
import { nuxtRouteScanner } from "./scanners/nuxt-route-scanner";

/**
 * All registered route scanners.
 *
 * To add support for a new framework, create a scanner that implements
 * `RouteScanner` and add it to this array. No other file needs to change.
 */
export const routeScanners: readonly RouteScanner[] = [
  nextRouteScanner,
  nuxtRouteScanner,
];
