import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  corporateAccountsCollection,
  corporateMembershipsCollection,
  packPurchasesCollection,
  usersCollection,
  vendorPromotionsCollection,
  vendorsCollection,
} from "@/lib/collections";
import {
  drinkSpecSchema,
  localDateSchema,
  newDocumentMeta,
  type CorporateMembership,
  type DrinkSpec,
  type PackAssignment,
  type PackPurchase,
  type VendorPromotion,
} from "@/lib/models";
import { isPromotionActiveOn, validateAssignmentCount } from "@/lib/promotions/pack-math";
import { packPurchaseToJson, vendorPromotionToJson } from "@/lib/promotions/serialize";
import { findUncoveredDrinkField, loadDrinkValueSets } from "@/lib/taxonomy";
import { cutoffInstantFor, localDateOf } from "@/lib/time";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const assignmentInputSchema = z.object({
  corporateMembershipId: z.string().regex(/^[0-9a-f]{24}$/i),
  /** Used only for buyer_choice packs; ignored for fixed_drink. */
  drinkSpec: drinkSpecSchema.optional(),
});

const buySchema = z.object({
  date: localDateSchema,
  vendorPromotionId: z.string().regex(/^[0-9a-f]{24}$/i),
  assignments: z.array(assignmentInputSchema).min(1).max(100),
  topUpMembershipIds: z
    .array(z.string().regex(/^[0-9a-f]{24}$/i))
    .max(500)
    .default([]),
});

const editSchema = z.object({
  date: localDateSchema,
  assignments: z.array(assignmentInputSchema).min(1).max(100),
  topUpMembershipIds: z
    .array(z.string().regex(/^[0-9a-f]{24}$/i))
    .max(500)
    .default([]),
});

const cancelSchema = z.object({ date: localDateSchema });

async function getOwnedAccount(userId: ObjectId) {
  const accounts = await corporateAccountsCollection();
  return accounts.findOne({ billingOwnerUserId: userId });
}

async function activeMembershipMap(accountId: ObjectId): Promise<Map<string, CorporateMembership>> {
  const memberships = await corporateMembershipsCollection();
  const docs = await memberships
    .find({ corporateAccountId: accountId, status: "active" })
    .toArray();
  return new Map(docs.map((m) => [m._id.toHexString(), m]));
}

type ResolvedCoverage =
  | { ok: true; assignments: PackAssignment[]; topUpMembershipIds: ObjectId[] }
  | { ok: false; status: number; error: string };

/**
 * Resolve + validate the assignment/top-up coverage for a pack purchase: the
 * count is locked to the pack size, every member must be an active member of
 * the company, top-ups can't overlap the pack, and each buyer_choice drink must
 * map onto the taxonomy. fixed_drink packs force the pack's drink (rule #6).
 */
async function resolveCoverage(
  promo: Pick<VendorPromotion, "packSize" | "packMode" | "fixedDrink">,
  members: Map<string, CorporateMembership>,
  assignmentsInput: z.infer<typeof assignmentInputSchema>[],
  topUpInput: string[],
): Promise<ResolvedCoverage> {
  const countCheck = validateAssignmentCount(promo.packSize!, assignmentsInput.length);
  if (!countCheck.ok) {
    return {
      ok: false,
      status: 422,
      error:
        countCheck.reason === "exceeds_pack_size"
          ? `This pack covers ${promo.packSize} coffees — assign at most that many.`
          : "Assign at least one member to the pack.",
    };
  }

  const assignedIds = new Set<string>();
  const assignments: PackAssignment[] = [];
  const valueSets = await loadDrinkValueSets();

  for (const input of assignmentsInput) {
    if (assignedIds.has(input.corporateMembershipId)) {
      return { ok: false, status: 422, error: "A member can't take two pack slots." };
    }
    const membership = members.get(input.corporateMembershipId);
    if (!membership) {
      return { ok: false, status: 422, error: "Assigned member isn't in your company." };
    }
    assignedIds.add(input.corporateMembershipId);

    let drink: DrinkSpec;
    if (promo.packMode === "fixed_drink") {
      drink = promo.fixedDrink!; // forced (rule #6)
    } else {
      if (!input.drinkSpec) {
        return { ok: false, status: 422, error: "Pick a drink for each member in this pack." };
      }
      const uncovered = findUncoveredDrinkField(valueSets, input.drinkSpec);
      if (uncovered) {
        return {
          ok: false,
          status: 422,
          error: `"${uncovered.value}" isn't an available ${uncovered.field} option.`,
        };
      }
      drink = input.drinkSpec;
    }
    assignments.push({ corporateMembershipId: membership._id, drinkSpec: drink });
  }

  const topUpIds: ObjectId[] = [];
  for (const id of topUpInput) {
    if (assignedIds.has(id)) {
      return { ok: false, status: 422, error: "A member can't be both in the pack and a top-up." };
    }
    const membership = members.get(id);
    if (!membership) {
      return { ok: false, status: 422, error: "Top-up member isn't in your company." };
    }
    topUpIds.push(membership._id);
  }

  return { ok: true, assignments, topUpMembershipIds: topUpIds };
}

/** Available packs for a date + the company's current purchase + members. */
export async function GET(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const url = new URL(request.url);
  const date = localDateSchema.safeParse(url.searchParams.get("date"));
  const targetDate = date.success ? date.data : localDateOf(new Date());

  const [promosCol, vendorsCol, packsCol, membersCol, usersCol] = await Promise.all([
    vendorPromotionsCollection(),
    vendorsCollection(),
    packPurchasesCollection(),
    corporateMembershipsCollection(),
    usersCollection(),
  ]);

  const [activePromos, currentPurchase, memberDocs] = await Promise.all([
    promosCol
      .find({
        type: "pack",
        status: "active",
        validFrom: { $lte: targetDate },
        validUntil: { $gte: targetDate },
      })
      .toArray(),
    packsCol.findOne({ corporateAccountId: account._id, date: targetDate }),
    membersCol.find({ corporateAccountId: account._id, status: "active" }).toArray(),
  ]);

  const vendorById = new Map(
    (await vendorsCol.find({ _id: { $in: activePromos.map((p) => p.vendorId) } }).toArray()).map(
      (v) => [v._id.toHexString(), v],
    ),
  );
  const userById = new Map(
    (await usersCol.find({ _id: { $in: memberDocs.map((m) => m.userId) } }).toArray()).map((u) => [
      u._id.toHexString(),
      u,
    ]),
  );

  return NextResponse.json({
    date: targetDate,
    cardOnFile: Boolean(account.companyStripePaymentMethodId),
    members: memberDocs.map((m) => ({
      membershipId: m._id.toHexString(),
      name: userById.get(m.userId.toHexString())?.name ?? "",
      email: userById.get(m.userId.toHexString())?.email ?? "",
    })),
    availablePacks: activePromos.map((p) => ({
      ...vendorPromotionToJson(p),
      vendorName: vendorById.get(p.vendorId.toHexString())?.businessName ?? "Vendor",
    })),
    currentPurchase: currentPurchase ? packPurchaseToJson(currentPurchase) : null,
  });
}

/** Buy a pack for a date (creates a pending PackPurchase). */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });
  if (!account.companyStripePaymentMethodId) {
    return NextResponse.json(
      { error: "Add a company card before buying a pack." },
      { status: 409 },
    );
  }

  const parsed = buySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const now = new Date();

  if (cutoffInstantFor(input.date).getTime() <= now.getTime()) {
    return NextResponse.json({ error: "That day's cutoff has passed." }, { status: 409 });
  }

  const promos = await vendorPromotionsCollection();
  const promo = await promos.findOne({ _id: new ObjectId(input.vendorPromotionId), type: "pack" });
  if (!promo) return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  if (!isPromotionActiveOn(promo, input.date)) {
    return NextResponse.json({ error: "That pack isn't available on that day." }, { status: 422 });
  }

  const members = await activeMembershipMap(account._id);
  const coverage = await resolveCoverage(
    promo,
    members,
    input.assignments,
    input.topUpMembershipIds,
  );
  if (!coverage.ok)
    return NextResponse.json({ error: coverage.error }, { status: coverage.status });

  const purchase: PackPurchase = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    corporateAccountId: account._id,
    vendorPromotionId: promo._id,
    date: input.date,
    packSnapshot: {
      vendorId: promo.vendorId,
      packSize: promo.packSize!,
      packPriceSen: promo.packPriceSen!,
      packMode: promo.packMode!,
      ...(promo.fixedDrink ? { fixedDrink: promo.fixedDrink } : {}),
      ...(promo.commissionRateOverrideBps !== undefined
        ? { commissionRateOverrideBps: promo.commissionRateOverrideBps }
        : {}),
    },
    assignments: coverage.assignments,
    topUpMembershipIds: coverage.topUpMembershipIds,
    topUpOrderIds: [],
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const packs = await packPurchasesCollection();
  try {
    await packs.insertOne(purchase);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return NextResponse.json(
        { error: "You already have a pack for that day — edit it instead." },
        { status: 409 },
      );
    }
    throw error;
  }
  return NextResponse.json(packPurchaseToJson(purchase), { status: 201 });
}

/** Edit a pending pack's assignments/top-ups (until that day's cutoff). */
export async function PATCH(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = editSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const now = new Date();

  const packs = await packPurchasesCollection();
  const purchase = await packs.findOne({
    corporateAccountId: account._id,
    date: input.date,
    status: "pending",
  });
  if (!purchase)
    return NextResponse.json({ error: "No editable pack for that day" }, { status: 404 });
  if (cutoffInstantFor(input.date).getTime() <= now.getTime()) {
    return NextResponse.json({ error: "That day's cutoff has passed." }, { status: 409 });
  }

  const members = await activeMembershipMap(account._id);
  const coverage = await resolveCoverage(
    purchase.packSnapshot,
    members,
    input.assignments,
    input.topUpMembershipIds,
  );
  if (!coverage.ok)
    return NextResponse.json({ error: coverage.error }, { status: coverage.status });

  await packs.updateOne(
    { _id: purchase._id },
    {
      $set: {
        assignments: coverage.assignments,
        topUpMembershipIds: coverage.topUpMembershipIds,
        updatedAt: now,
      },
    },
  );
  return NextResponse.json({ ok: true });
}

/** Cancel a pending pack before its cutoff. */
export async function DELETE(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = await getOwnedAccount(user._id);
  if (!account) return NextResponse.json({ error: "No corporate account" }, { status: 404 });

  const parsed = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (cutoffInstantFor(parsed.data.date).getTime() <= new Date().getTime()) {
    return NextResponse.json({ error: "That day's cutoff has passed." }, { status: 409 });
  }

  const packs = await packPurchasesCollection();
  const result = await packs.deleteOne({
    corporateAccountId: account._id,
    date: parsed.data.date,
    status: "pending",
  });
  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "No editable pack for that day" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
