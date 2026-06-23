import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { newDocumentMeta } from "@/lib/models";
import type { Location, Order, Preference, Subscription, Vendor } from "@/lib/models";
import {
  buildOrder,
  distanceKm,
  evaluateCutoff,
  evaluateGeneration,
  isModifiable,
} from "@/lib/order-engine/logic";

const now = new Date("2026-06-09T12:00:00Z"); // 20:00 KL on June 9
const WEDNESDAY = "2026-06-10";
const SATURDAY = "2026-06-13";

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    userId: new ObjectId(),
    plan: "weekday",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    status: "active",
    quota: { total: 22, used: 0 },
    currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePreference(userId: ObjectId, overrides: Partial<Preference> = {}): Preference {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    userId,
    scope: "personal",
    defaultDrink: {
      drink: "Flat White",
      size: "regular",
      milk: "Oat",
      sugar: 1,
      strength: "strong",
    },
    schedule: { days: [1, 2, 3, 4, 5], time: "08:00" },
    defaultLocationId: new ObjectId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeLocation(userId: ObjectId): Location {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    userId,
    label: "Office",
    address: "Level 12, Menara TECZO, KL",
    geo: { lat: 3.139, lng: 101.6869 },
    notes: "Ask for Aiman",
    createdAt: now,
    updatedAt: now,
  };
}

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    businessName: "Kopi Corner",
    status: "active",
    address: "Jalan Sultan Ismail",
    geo: { lat: 3.14, lng: 101.69 },
    capabilities: ["oat_milk"],
    capacityPerHour: 30,
    portalUserSubs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("evaluateGeneration", () => {
  it("generates for an active subscription scheduled on that weekday", () => {
    const sub = makeSubscription();
    const pref = makePreference(sub.userId); // Mon–Fri
    expect(evaluateGeneration(sub, pref, WEDNESDAY)).toEqual({ ok: true });
  });

  it.each(["paused", "past_due", "canceled", "incomplete"] as const)(
    "skips %s subscriptions",
    (status) => {
      const sub = makeSubscription({ status });
      const pref = makePreference(sub.userId);
      expect(evaluateGeneration(sub, pref, WEDNESDAY)).toEqual({
        ok: false,
        reason: "subscription_inactive",
      });
    },
  );

  it("allows trialing subscriptions", () => {
    const sub = makeSubscription({ status: "trialing" });
    const pref = makePreference(sub.userId);
    expect(evaluateGeneration(sub, pref, WEDNESDAY)).toEqual({ ok: true });
  });

  it("skips when the monthly quota is exhausted", () => {
    const sub = makeSubscription({ quota: { total: 22, used: 22 } });
    const pref = makePreference(sub.userId);
    expect(evaluateGeneration(sub, pref, WEDNESDAY)).toEqual({
      ok: false,
      reason: "quota_exhausted",
    });
  });

  it("skips when the user has no preference set", () => {
    const sub = makeSubscription();
    expect(evaluateGeneration(sub, null, WEDNESDAY)).toEqual({
      ok: false,
      reason: "no_preference",
    });
  });

  it("skips days outside the delivery schedule", () => {
    const sub = makeSubscription();
    const pref = makePreference(sub.userId); // Mon–Fri only
    expect(evaluateGeneration(sub, pref, SATURDAY)).toEqual({
      ok: false,
      reason: "not_scheduled_today",
    });
  });
});

describe("distanceKm", () => {
  it("is zero for identical points and grows with separation", () => {
    const a = { lat: 3.139, lng: 101.6869 };
    expect(distanceKm(a, a)).toBe(0);
    // KL to Penang is roughly 290–300 km as the crow flies.
    const penang = { lat: 5.4141, lng: 100.3288 };
    const d = distanceKm(a, penang);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(350);
  });
});

describe("buildOrder", () => {
  it("snapshots drink, location, and vendor with correct UTC instants", () => {
    const sub = makeSubscription();
    const pref = makePreference(sub.userId);
    const location = makeLocation(sub.userId);
    const vendor = makeVendor();

    const order = buildOrder({
      subscription: sub,
      preference: pref,
      location,
      vendor,
      assignmentMethod: "ai_routed",
      localDate: WEDNESDAY,
      now,
    });

    expect(order.userId.equals(sub.userId)).toBe(true);
    expect(order.subscriptionId.equals(sub._id)).toBe(true);
    expect(order.date).toBe(WEDNESDAY);
    expect(order.status).toBe("scheduled");
    expect(order.assignmentMethod).toBe("ai_routed");
    expect(order.autoGenerated).toBe(true);
    // Snapshots are copies, not references.
    expect(order.drink).toEqual(pref.defaultDrink);
    expect(order.drink).not.toBe(pref.defaultDrink);
    expect(order.location.label).toBe("Office");
    expect(order.location.notes).toBe("Ask for Aiman");
    expect(order.vendorId.equals(vendor._id)).toBe(true);
    // Cutoff 06:00 KL on June 10 = 22:00 UTC June 9.
    expect(order.cutoffAt.toISOString()).toBe("2026-06-09T22:00:00.000Z");
    // Delivery 08:00 KL on June 10 = 00:00 UTC June 10.
    expect(order.deliverAt.toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });

  it("later preference edits don't leak into an existing snapshot", () => {
    const sub = makeSubscription();
    const pref = makePreference(sub.userId);
    const order = buildOrder({
      subscription: sub,
      preference: pref,
      location: makeLocation(sub.userId),
      vendor: makeVendor(),
      assignmentMethod: "ai_routed",
      localDate: WEDNESDAY,
      now,
    });

    pref.defaultDrink.drink = "Mocha";
    expect(order.drink.drink).toBe("Flat White");
  });
});

describe("evaluateCutoff", () => {
  it("confirms for live subscriptions with quota left", () => {
    expect(evaluateCutoff(makeSubscription())).toEqual({ action: "confirm" });
    expect(evaluateCutoff(makeSubscription({ status: "trialing" }))).toEqual({
      action: "confirm",
    });
  });

  it("fails when the subscription is gone or inactive", () => {
    expect(evaluateCutoff(null)).toEqual({
      action: "fail",
      reason: "subscription_inactive",
    });
    expect(evaluateCutoff(makeSubscription({ status: "paused" }))).toEqual({
      action: "fail",
      reason: "subscription_inactive",
    });
    expect(evaluateCutoff(makeSubscription({ status: "canceled" }))).toEqual({
      action: "fail",
      reason: "subscription_inactive",
    });
  });

  it("fails when quota is exhausted (skipped orders never consumed it)", () => {
    expect(evaluateCutoff(makeSubscription({ quota: { total: 12, used: 12 } }))).toEqual({
      action: "fail",
      reason: "quota_exhausted",
    });
  });

  it("ignores the quota cap for card-on-file memberships (paid per coffee)", () => {
    expect(
      evaluateCutoff(
        makeSubscription({ billingMode: "card_on_file", quota: { total: 12, used: 12 } }),
      ),
    ).toEqual({ action: "confirm" });
  });

  it("still requires an active membership for card-on-file", () => {
    expect(
      evaluateCutoff(makeSubscription({ billingMode: "card_on_file", status: "canceled" })),
    ).toEqual({ action: "fail", reason: "subscription_inactive" });
  });
});

describe("isModifiable", () => {
  function makeOrder(status: Order["status"], cutoffAt: Date): Order {
    const sub = makeSubscription();
    const order = buildOrder({
      subscription: sub,
      preference: makePreference(sub.userId),
      location: makeLocation(sub.userId),
      vendor: makeVendor(),
      assignmentMethod: "ai_routed",
      localDate: WEDNESDAY,
      now,
    });
    return { ...order, status, cutoffAt };
  }

  const cutoff = new Date("2026-06-09T22:00:00Z");

  it("allows changes to scheduled/skipped orders before cutoff", () => {
    const before = new Date("2026-06-09T21:59:59Z");
    expect(isModifiable(makeOrder("scheduled", cutoff), before)).toBe(true);
    expect(isModifiable(makeOrder("skipped", cutoff), before)).toBe(true);
  });

  it("locks at and after the cutoff instant", () => {
    expect(isModifiable(makeOrder("scheduled", cutoff), cutoff)).toBe(false);
    expect(isModifiable(makeOrder("scheduled", cutoff), new Date("2026-06-09T22:00:01Z"))).toBe(
      false,
    );
  });

  it("never allows modifying locked statuses", () => {
    const before = new Date("2026-06-09T21:59:59Z");
    for (const status of ["confirmed", "preparing", "out_for_delivery", "delivered", "failed"]) {
      expect(isModifiable(makeOrder(status as Order["status"], cutoff), before)).toBe(false);
    }
  });
});

describe("idempotency key", () => {
  it("two generations for the same user+date collide on the unique key", () => {
    // The DB enforces uniqueness on (userId, date); here we assert the
    // builder really does produce the same key for repeated runs.
    const sub = makeSubscription();
    const pref = makePreference(sub.userId);
    const location = makeLocation(sub.userId);
    const vendor = makeVendor();
    const a = buildOrder({
      subscription: sub,
      preference: pref,
      location,
      vendor,
      assignmentMethod: "ai_routed",
      localDate: WEDNESDAY,
      now,
    });
    const b = buildOrder({
      subscription: sub,
      preference: pref,
      location,
      vendor,
      assignmentMethod: "ai_routed",
      localDate: WEDNESDAY,
      now,
    });
    expect(a.userId.equals(b.userId)).toBe(true);
    expect(a.date).toBe(b.date);
    expect(a._id.equals(b._id)).toBe(false); // distinct docs, same logical key
  });
});
