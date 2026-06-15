import { commissionConfigCollection } from "@/lib/collections";
import type { Vendor } from "@/lib/models";
import { effectiveCommissionBps, PLATFORM_DEFAULT_COMMISSION_BPS } from "@/lib/payments/money";

/**
 * Platform default commission rate (bps). Reads the CommissionConfig
 * singleton, falling back to the code default when unset so the system works
 * before an admin configures anything.
 */
export async function getPlatformCommissionBps(): Promise<number> {
  const config = await commissionConfigCollection();
  const doc = await config.findOne({ key: "platform" });
  return doc?.defaultRateBps ?? PLATFORM_DEFAULT_COMMISSION_BPS;
}

/** The commission rate (bps) that applies to a given vendor: their override
 * when set, else the platform default. */
export async function resolveCommissionBps(vendor: Vendor): Promise<number> {
  const platformDefault = await getPlatformCommissionBps();
  return effectiveCommissionBps(platformDefault, vendor.commissionRateOverrideBps);
}
