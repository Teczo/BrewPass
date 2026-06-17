import { ObjectId } from "mongodb";

import {
  locationsCollection,
  monthlyListsCollection,
  ordersCollection,
  preferencesCollection,
  vendorMenuItemsCollection,
  vendorsCollection,
} from "@/lib/collections";
import { newDocumentMeta } from "@/lib/models";
import type { DrinkSpec, MonthlyList, MonthlyListEntry, Subscription, User } from "@/lib/models";
import { ordersFromList, planMonthlyEntries } from "@/lib/monthly-list/planner";
import { loadRoutingCandidates } from "@/lib/order-engine/routing-data";
import { slugify } from "@/lib/taxonomy";
import { localDateOf, localTimeOf, tomorrowLocalDate } from "@/lib/time";

/** The KL calendar month (YYYY-MM) of a local date. */
export function periodOf(localDate: string): string {
  return localDate.slice(0, 7);
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

/**
 * Earliest delivery day to plan for a period: tomorrow when planning the
 * current month (today's order is already handled by live generation), else
 * the first of a future month.
 */
function fromDateFor(period: string, now: Date): string {
  const currentMonth = periodOf(localDateOf(now));
  if (period === currentMonth) return tomorrowLocalDate(now);
  return period > currentMonth ? `${period}-01` : tomorrowLocalDate(now);
}

/** Per-vendor price for a drink, in sen, from published menu items. */
async function loadPriceLookup(
  vendorIds: ObjectId[],
): Promise<(vendorId: ObjectId, drink: DrinkSpec) => number | null> {
  const menuItems = await vendorMenuItemsCollection();
  const items = await menuItems.find({ vendorId: { $in: vendorIds } }).toArray();
  const priceByVendorSlug = new Map<string, number>();
  for (const item of items) {
    if (item.priceSen !== undefined) {
      priceByVendorSlug.set(`${item.vendorId.toHexString()}:${item.taxonomySlug}`, item.priceSen);
    }
  }
  return (vendorId, drink) =>
    priceByVendorSlug.get(`${vendorId.toHexString()}:${slugify(drink.drink)}`) ?? null;
}

/** Business-name lookup for every vendor assigned anywhere in the list. */
export async function vendorNamesForList(list: MonthlyList): Promise<Map<string, string>> {
  const ids = [
    ...new Set(list.entries.flatMap((e) => (e.vendorId ? [e.vendorId.toHexString()] : []))),
  ];
  if (ids.length === 0) return new Map();
  const vendors = await vendorsCollection();
  const docs = await vendors
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
    .project<{ _id: ObjectId; businessName: string }>({ businessName: 1 })
    .toArray();
  return new Map(docs.map((vendor) => [vendor._id.toHexString(), vendor.businessName]));
}

export interface ProposeResult {
  ok: true;
  list: MonthlyList;
}
export interface ProposeError {
  ok: false;
  reason: "no_subscription" | "no_preference" | "no_location" | "already_confirmed";
}

/**
 * Build (or rebuild) a proposed monthly list for the user and persist it.
 * Refuses to overwrite an already-confirmed list — those orders exist and
 * are edited through the normal per-day flow. Upserts on (userId, period).
 */
export async function proposeMonthlyList(
  user: User,
  subscription: Subscription | null,
  period: string,
  now: Date = new Date(),
): Promise<ProposeResult | ProposeError> {
  if (!subscription) return { ok: false, reason: "no_subscription" };

  const [preferences, locations, monthlyLists] = await Promise.all([
    preferencesCollection(),
    locationsCollection(),
    monthlyListsCollection(),
  ]);

  const existing = await monthlyLists.findOne({ userId: user._id, period });
  if (existing?.status === "confirmed") return { ok: false, reason: "already_confirmed" };

  const preference = await preferences.findOne({ userId: user._id });
  if (!preference) return { ok: false, reason: "no_preference" };

  const location = await locations.findOne({
    _id: preference.defaultLocationId,
    userId: user._id,
  });
  if (!location) return { ok: false, reason: "no_location" };

  const fromDate = fromDateFor(period, now);
  const candidates = await loadRoutingCandidates(fromDate);
  const priceFor = await loadPriceLookup(candidates.map((candidate) => candidate.vendor._id));

  const entries = planMonthlyEntries({
    period,
    fromDate,
    scheduleDays: preference.schedule.days,
    time: preference.schedule.time,
    drink: preference.defaultDrink,
    point: location.geo,
    preferredVendorId: preference.preferredVendorId ?? null,
    candidates,
    nowLocalDate: localDateOf(now),
    nowLocalTime: localTimeOf(now),
    priceFor,
  });

  const generationMethod = preference.preferredVendorId ? "manual" : "ai";
  const list = await monthlyLists.findOneAndUpdate(
    { userId: user._id, period },
    {
      $set: {
        subscriptionId: subscription._id,
        status: "proposed" as const,
        generationMethod,
        time: preference.schedule.time,
        location: {
          locationId: location._id,
          label: location.label,
          address: location.address,
          geo: { ...location.geo },
          ...(location.notes ? { notes: location.notes } : {}),
        },
        entries,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId(),
        ...newDocumentMeta(),
        userId: user._id,
        period,
        createdAt: now,
      },
      $unset: { confirmedAt: "" },
    },
    { upsert: true, returnDocument: "after" },
  );
  return { ok: true, list: list! };
}

export interface EntryEdit {
  date: string;
  /** Replace the drink for the day. */
  drink?: DrinkSpec;
  /** Assign a vendor (must be active) or clear it (null → nightly fallback). */
  vendorId?: string | null;
  /** Skip / un-skip the day. */
  skipped?: boolean;
}

export type EditResult =
  | { ok: true; list: MonthlyList }
  | { ok: false; reason: "not_found" | "already_confirmed" | "invalid_vendor" | "invalid_date" };

/**
 * Apply user edits to a proposed list (critical rule #7 — only pre-confirm).
 * Re-snapshots the price whenever the vendor or drink changes; a manually
 * assigned vendor is recorded as `user_preferred`.
 */
export async function editMonthlyList(
  userId: ObjectId,
  period: string,
  edits: EntryEdit[],
  now: Date = new Date(),
): Promise<EditResult> {
  const monthlyLists = await monthlyListsCollection();
  const list = await monthlyLists.findOne({ userId, period });
  if (!list) return { ok: false, reason: "not_found" };
  if (list.status === "confirmed") return { ok: false, reason: "already_confirmed" };

  const editByDate = new Map(edits.map((edit) => [edit.date, edit]));
  if (![...editByDate.keys()].every((date) => list.entries.some((entry) => entry.date === date))) {
    return { ok: false, reason: "invalid_date" };
  }

  // Validate and resolve any newly assigned vendors up front.
  const requestedVendorIds = edits
    .map((edit) => edit.vendorId)
    .filter((id): id is string => typeof id === "string");
  let activeVendorIds = new Set<string>();
  if (requestedVendorIds.length > 0) {
    if (!requestedVendorIds.every((id) => /^[0-9a-f]{24}$/i.test(id))) {
      return { ok: false, reason: "invalid_vendor" };
    }
    const vendors = await vendorsCollection();
    const found = await vendors
      .find({ _id: { $in: requestedVendorIds.map((id) => new ObjectId(id)) }, status: "active" })
      .toArray();
    activeVendorIds = new Set(found.map((vendor) => vendor._id.toHexString()));
    if (activeVendorIds.size !== new Set(requestedVendorIds).size) {
      return { ok: false, reason: "invalid_vendor" };
    }
  }

  const priceFor = await loadPriceLookup(
    list.entries
      .flatMap((e) => (e.vendorId ? [e.vendorId] : []))
      .concat(requestedVendorIds.map((id) => new ObjectId(id))),
  );

  const entries: MonthlyListEntry[] = list.entries.map((entry) => {
    const edit = editByDate.get(entry.date);
    if (!edit) return entry;

    const next: MonthlyListEntry = { ...entry, drink: { ...entry.drink } };
    if (edit.drink) next.drink = { ...edit.drink };
    if (edit.skipped !== undefined) next.skipped = edit.skipped;
    if (edit.vendorId !== undefined) {
      next.vendorId = edit.vendorId === null ? null : new ObjectId(edit.vendorId);
      next.assignmentMethod = next.vendorId ? "user_preferred" : null;
    }
    // Re-snapshot the price when vendor or drink changed.
    if (edit.vendorId !== undefined || edit.drink) {
      const price = next.vendorId ? priceFor(next.vendorId, next.drink) : null;
      if (price !== null) next.priceSen = price;
      else delete next.priceSen;
    }
    return next;
  });

  const updated = await monthlyLists.findOneAndUpdate(
    { _id: list._id, status: "proposed" },
    { $set: { entries, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (!updated) return { ok: false, reason: "already_confirmed" };
  return { ok: true, list: updated };
}

export interface ConfirmResult {
  ok: true;
  list: MonthlyList;
  created: number;
  duplicates: number;
}
export type ConfirmError = { ok: false; reason: "not_found" | "already_confirmed" };

/**
 * Confirm a proposed list: create one scheduled Order per planned, non-skipped
 * day, then mark the list confirmed. Idempotent — the unique (userId, date)
 * order index absorbs days that already have an order, and a re-run after a
 * partial crash simply re-inserts the missing ones (critical rule #1).
 */
export async function confirmMonthlyList(
  userId: ObjectId,
  period: string,
  now: Date = new Date(),
): Promise<ConfirmResult | ConfirmError> {
  const [monthlyLists, orders] = await Promise.all([monthlyListsCollection(), ordersCollection()]);
  const list = await monthlyLists.findOne({ userId, period });
  if (!list) return { ok: false, reason: "not_found" };

  // Create the orders before flipping status, so a crash leaves the list
  // re-confirmable. Already-confirmed lists may still be (re-)swept safely.
  const toCreate = ordersFromList(list, now);
  let created = 0;
  let duplicates = 0;
  for (const order of toCreate) {
    try {
      await orders.insertOne(order);
      created += 1;
    } catch (error) {
      if (isDuplicateKeyError(error)) duplicates += 1;
      else throw error;
    }
  }

  const updated = await monthlyLists.findOneAndUpdate(
    { _id: list._id },
    {
      $set: { status: "confirmed" as const, confirmedAt: list.confirmedAt ?? now, updatedAt: now },
    },
    { returnDocument: "after" },
  );
  return { ok: true, list: updated!, created, duplicates };
}

/**
 * (userId → skipped) lookup for one date, drawn from confirmed lists in that
 * date's period. The nightly generation job consults this so explicitly
 * skipped days never get an auto-generated order.
 */
export async function loadSkippedUserIdsForDate(localDate: string): Promise<Set<string>> {
  const monthlyLists = await monthlyListsCollection();
  const lists = await monthlyLists
    .find({ status: "confirmed", period: periodOf(localDate) })
    .project<{ userId: ObjectId; entries: Array<{ date: string; skipped: boolean }> }>({
      userId: 1,
      entries: 1,
    })
    .toArray();

  const skipped = new Set<string>();
  for (const list of lists) {
    if (list.entries.some((entry) => entry.date === localDate && entry.skipped)) {
      skipped.add(list.userId.toHexString());
    }
  }
  return skipped;
}
