/**
 * Permission model — placeholder only.
 *
 * Plugins declare permissions in their manifest so the intent is visible and
 * auditable. Actual enforcement is intentionally NOT implemented: the server
 * approval policy (phase 6) owns that, and it is currently disabled, so all
 * declared permissions are treated as allowed.
 */

export const KNOWN_PERMISSIONS = ['fs.read', 'fs.write', 'shell', 'network'] as const;

export type KnownPermission = (typeof KNOWN_PERMISSIONS)[number];

export interface PermissionInfo {
  readonly name: string;
  readonly known: boolean;
}

/** Classify a declared permission as known or custom (unknown). */
export function describePermission(name: string): PermissionInfo {
  return {
    name,
    known: (KNOWN_PERMISSIONS as readonly string[]).includes(name),
  };
}

/**
 * Placeholder policy: every permission is allowed.
 *
 * Replace with server-driven approval checks when phase 6 lands.
 */
export function isPermissionAllowed(_permission: string): boolean {
  return true;
}
