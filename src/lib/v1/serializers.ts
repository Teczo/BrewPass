import type { MonthlyList, Order, User, Vendor } from "@/lib/models";

/**
 * `/v1` serializers (Phase I.4). Every shape is keyed by `externalId`
 * exposed as `id`; no raw Mongo `_id` ever crosses the boundary (critical
 * rule #14). Internal references (a vendor on an order, the vendor assigned
 * to a monthly-list day) are translated to the referenced entity's
 * `externalId` via a caller-supplied lookup, so the boundary stays free of
 * internal ids. Pure and unit-tested; the route handlers do the DB I/O.
 */

export function v1User(user: User) {
  return {
    id: user.externalId,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
  };
}

/**
 * Subscriber-facing vendor view: only the fields a customer needs to browse
 * and choose. Stripe Connect, commission, raw quality counters, and portal
 * membership are deliberately omitted — they are operator/vendor concerns.
 */
export function v1Vendor(vendor: Vendor) {
  return {
    id: vendor.externalId,
    businessName: vendor.businessName,
    status: vendor.status,
    address: vendor.address,
    geo: vendor.geo,
    operatingHours: vendor.operatingHours ?? null,
    serviceAreaRadiusKm: vendor.serviceAreaRadiusKm ?? null,
    rating: {
      score: vendor.ratingScore ?? null,
      count: vendor.ratingCount ?? 0,
    },
  };
}

export function v1Order(order: Order, vendorExternalId: string | null) {
  return {
    id: order.externalId,
    date: order.date,
    status: order.status,
    drink: order.drink,
    vendorId: vendorExternalId,
    location: {
      label: order.location.label,
      address: order.location.address,
    },
    priceSen: order.priceSen ?? null,
    assignmentMethod: order.assignmentMethod ?? null,
    chargeStatus: order.chargeStatus ?? null,
    cutoffAt: order.cutoffAt.toISOString(),
    deliverAt: order.deliverAt.toISOString(),
    addOns: order.addOns ?? [],
  };
}

/**
 * A monthly list with each day's assigned vendor rendered as its
 * `externalId`. `vendorExternalIdByHex` maps internal vendor `_id` hex →
 * `externalId`; a day with no assigned vendor (or one missing from the map)
 * serializes to `null`.
 */
export function v1MonthlyList(list: MonthlyList, vendorExternalIdByHex: Map<string, string>) {
  return {
    id: list.externalId,
    period: list.period,
    status: list.status,
    generationMethod: list.generationMethod,
    time: list.time,
    location: { label: list.location.label, address: list.location.address },
    entries: list.entries.map((entry) => {
      const hex = entry.vendorId?.toHexString() ?? null;
      return {
        date: entry.date,
        weekday: entry.weekday,
        drink: entry.drink,
        vendorId: hex ? (vendorExternalIdByHex.get(hex) ?? null) : null,
        assignmentMethod: entry.assignmentMethod,
        priceSen: entry.priceSen ?? null,
        skipped: entry.skipped,
      };
    }),
  };
}
