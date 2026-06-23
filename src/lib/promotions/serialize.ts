import type { PackPurchase, VendorPromotion } from "@/lib/models";

/** API-boundary shape for a vendor promotion (uses externalId, never _id). */
export function vendorPromotionToJson(promo: VendorPromotion) {
  return {
    id: promo._id.toHexString(),
    externalId: promo.externalId,
    vendorId: promo.vendorId.toHexString(),
    type: promo.type,
    name: promo.name,
    status: promo.status,
    validFrom: promo.validFrom,
    validUntil: promo.validUntil,
    packSize: promo.packSize ?? null,
    packPriceSen: promo.packPriceSen ?? null,
    packMode: promo.packMode ?? null,
    fixedDrink: promo.fixedDrink ?? null,
  };
}

/** API-boundary shape for a pack purchase. */
export function packPurchaseToJson(purchase: PackPurchase) {
  return {
    id: purchase._id.toHexString(),
    externalId: purchase.externalId,
    vendorPromotionId: purchase.vendorPromotionId.toHexString(),
    date: purchase.date,
    status: purchase.status,
    chargeStatus: purchase.chargeStatus ?? null,
    packSnapshot: {
      vendorId: purchase.packSnapshot.vendorId.toHexString(),
      packSize: purchase.packSnapshot.packSize,
      packPriceSen: purchase.packSnapshot.packPriceSen,
      packMode: purchase.packSnapshot.packMode,
      fixedDrink: purchase.packSnapshot.fixedDrink ?? null,
    },
    assignments: purchase.assignments.map((a) => ({
      corporateMembershipId: a.corporateMembershipId.toHexString(),
      drinkSpec: a.drinkSpec,
    })),
    topUpMembershipIds: purchase.topUpMembershipIds.map((id) => id.toHexString()),
  };
}
