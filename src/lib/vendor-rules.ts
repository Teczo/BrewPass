import type { VendorStatus } from "@/lib/models/vendor";

/**
 * Pure vendor status rules, unit-tested. The route handlers only add
 * auth + database I/O around these.
 */

/** Statuses that may use the vendor portal (see orders, edit profile). */
export const PORTAL_STATUSES = ["active", "paused", "offline"] as const satisfies VendorStatus[];
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

function isPortalStatus(status: VendorStatus): status is PortalStatus {
  return (PORTAL_STATUSES as readonly VendorStatus[]).includes(status);
}

/**
 * Self-service status changes: vendors move freely between the operational
 * statuses but can never leave `pending`/`rejected`/`suspended` themselves.
 */
export function canVendorSetStatus(current: VendorStatus, next: VendorStatus): boolean {
  return isPortalStatus(current) && isPortalStatus(next);
}

/** Statuses an admin can set directly (suspend/reinstate/pause). */
const ADMIN_SETTABLE = ["active", "paused", "suspended", "offline"] as const;

/**
 * Admin status controls. The application states are excluded on both
 * sides: `pending`/`rejected` vendors go through the review flow
 * (approve/reject), never a direct status set.
 */
export function canAdminSetStatus(current: VendorStatus, next: VendorStatus): boolean {
  return (
    (ADMIN_SETTABLE as readonly VendorStatus[]).includes(current) &&
    (ADMIN_SETTABLE as readonly VendorStatus[]).includes(next)
  );
}
