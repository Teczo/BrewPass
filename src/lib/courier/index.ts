import type { CourierProvider, Vendor } from "@/lib/models";
import { lalamoveAdapter } from "@/lib/courier/lalamove";
import type { CourierAdapter } from "@/lib/courier/types";

/**
 * Courier registry (v2.1). The single place that maps a `CourierProvider` to
 * its adapter and decides which provider fulfils a given vendor. Everything
 * else routes through here so adding Grab (or an own-fleet adapter) is a
 * one-line change.
 */

const ADAPTERS: Partial<Record<CourierProvider, CourierAdapter>> = {
  lalamove: lalamoveAdapter,
  // grab: grabAdapter,  // second adapter, behind the same interface (deferred)
};

/** The configured platform-primary courier (Lalamove first). */
export const PLATFORM_PRIMARY_COURIER: CourierProvider = "lalamove";

/** Adapter for a provider, or null for `manual` / a not-yet-built provider. */
export function getCourierAdapter(provider: CourierProvider): CourierAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/**
 * Which provider should carry this vendor's handoffs.
 *  - A vendor explicitly set to `manual` always self-delivers.
 *  - Otherwise use the vendor's chosen provider (or the platform primary) when
 *    its adapter is built AND configured with live credentials.
 *  - Fall back to `manual` when no courier is available — the app keeps working
 *    without courier infra (same spirit as the best-effort SMS/push senders).
 */
export function resolveCourierProvider(vendor: Pick<Vendor, "courierProvider">): CourierProvider {
  if (vendor.courierProvider === "manual") return "manual";
  const provider = vendor.courierProvider ?? PLATFORM_PRIMARY_COURIER;
  const adapter = getCourierAdapter(provider);
  if (adapter?.isConfigured()) return provider;
  return "manual";
}
