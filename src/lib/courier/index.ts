import type { CourierProvider, Market, Vendor } from "@/lib/models";
import { doordashDriveAdapter } from "@/lib/courier/doordash-drive";
import { lalamoveAdapter } from "@/lib/courier/lalamove";
import { uberDirectAdapter } from "@/lib/courier/uber-direct";
import type { CourierAdapter } from "@/lib/courier/types";

/**
 * Courier registry (v2.1 + Phase M). The single place that maps a
 * `CourierProvider` to its adapter and decides which provider(s) fulfil a given
 * vendor. Everything routes through here so adding an adapter is a one-line
 * change and the market/fallback policy lives in exactly one spot (critical
 * rule #23 — fallback logic lives here, never inside an adapter).
 */

const ADAPTERS: Partial<Record<CourierProvider, CourierAdapter>> = {
  lalamove: lalamoveAdapter,
  uber_direct: uberDirectAdapter,
  doordash_drive: doordashDriveAdapter,
  // grab: grabAdapter,  // reserved, behind the same interface (deferred)
};

/** Each market's primary courier. MY → Lalamove, AU → Uber Direct (Phase M). */
export const MARKET_PRIMARY_COURIERS: Record<Market, CourierProvider> = {
  MY: "lalamove",
  AU: "uber_direct",
};

/**
 * Ordered AU dispatch chain (Phase M): Uber Direct primary, DoorDash Drive
 * Classic fallback. `dispatchForHandoff` walks this in order, moving to the
 * next provider when one's `dispatch()` fails — AU vendors do not choose their
 * courier. MY has a single provider, so its chain is just `[lalamove]`.
 */
export const AU_FALLBACK_CHAIN: CourierProvider[] = ["uber_direct", "doordash_drive"];

/** The configured platform-primary courier (the MY launch market's primary). */
export const PLATFORM_PRIMARY_COURIER: CourierProvider = MARKET_PRIMARY_COURIERS.MY;

/** Adapter for a provider, or null for `manual` / a not-yet-built provider. */
export function getCourierAdapter(provider: CourierProvider): CourierAdapter | null {
  return ADAPTERS[provider] ?? null;
}

/** A provider whose adapter is built AND configured with live credentials. */
function isLiveProvider(provider: CourierProvider): boolean {
  return getCourierAdapter(provider)?.isConfigured() ?? false;
}

/** The ordered candidate chain for a market, before the configured-filter. */
function marketChain(market: Market): CourierProvider[] {
  return market === "AU" ? AU_FALLBACK_CHAIN : [MARKET_PRIMARY_COURIERS[market]];
}

/**
 * The ordered list of providers to try for this vendor's handoff (Phase M).
 *  - A vendor explicitly set to `manual` always self-delivers → `["manual"]`.
 *  - An explicit `courierProvider` override is used alone when it's live, else
 *    falls through to `manual` (the vendor opted out of platform routing).
 *  - Otherwise the vendor's market chain, filtered to live adapters, in order
 *    (AU: Uber Direct → DoorDash Drive). No live adapter → `["manual"]`, so the
 *    app keeps working without courier infra (same spirit as best-effort SMS).
 *
 * `vendor.market` defaults to `MY` defensively for any row not yet backfilled
 * by the Phase M migration.
 */
export function resolveCourierChain(
  vendor: Pick<Vendor, "courierProvider" | "market">,
): CourierProvider[] {
  if (vendor.courierProvider === "manual") return ["manual"];

  if (vendor.courierProvider) {
    return isLiveProvider(vendor.courierProvider) ? [vendor.courierProvider] : ["manual"];
  }

  const live = marketChain(vendor.market ?? "MY").filter(isLiveProvider);
  return live.length > 0 ? live : ["manual"];
}

/**
 * The single provider that should carry this vendor's handoff — the head of the
 * resolved chain. Kept for callers that want one value (display, the
 * already-dispatched no-op path); dispatch itself walks the full chain.
 */
export function resolveCourierProvider(
  vendor: Pick<Vendor, "courierProvider" | "market">,
): CourierProvider {
  return resolveCourierChain(vendor)[0];
}
