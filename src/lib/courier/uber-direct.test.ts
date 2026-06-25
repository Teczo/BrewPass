import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uberDirectAdapter } from "@/lib/courier/uber-direct";

const SECRET = "whsec_test_uber";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("uberDirectAdapter.parseWebhook", () => {
  it("parses a delivery.status.changed event into the neutral event", () => {
    const body = JSON.stringify({
      kind: "event.delivery_status",
      delivery_id: "del_123",
      status: "pickup",
      created: "2024-01-01T09:00:00.000Z",
    });
    const event = uberDirectAdapter.parseWebhook(body);
    expect(event).not.toBeNull();
    expect(event?.courierOrderId).toBe("del_123");
    expect(event?.rawStatus).toBe("pickup");
    expect(event?.deliveryStatus).toBe("assigned");
    expect(event?.eventAt.toISOString()).toBe("2024-01-01T09:00:00.000Z");
  });

  it("extracts courier identity and location from the nested data object", () => {
    const body = JSON.stringify({
      delivery_id: "del_9",
      status: "dropoff",
      data: {
        courier: {
          name: "Mia",
          phone_number: "+61400",
          vehicle_type: "bicycle",
          location: { lat: -31.95, lng: 115.86 },
        },
      },
    });
    const event = uberDirectAdapter.parseWebhook(body);
    expect(event?.deliveryStatus).toBe("picked_up");
    expect(event?.driver).toEqual({ name: "Mia", phone: "+61400", plate: "bicycle" });
    expect(event?.lat).toBeCloseTo(-31.95);
    expect(event?.lng).toBeCloseTo(115.86);
  });

  it("maps delivered → delivered and canceled → failed", () => {
    const done = uberDirectAdapter.parseWebhook(
      JSON.stringify({ delivery_id: "A", status: "delivered" }),
    );
    expect(done?.deliveryStatus).toBe("delivered");
    const cancelled = uberDirectAdapter.parseWebhook(
      JSON.stringify({ delivery_id: "A", status: "canceled" }),
    );
    expect(cancelled?.deliveryStatus).toBe("failed");
  });

  it("parses but carries no transition for an info-only status", () => {
    const event = uberDirectAdapter.parseWebhook(
      JSON.stringify({ delivery_id: "A", status: "en_route_to_dropoff" }),
    );
    expect(event?.deliveryStatus).toBeNull();
  });

  it("returns null for an unparseable body or a payload without a delivery ref", () => {
    expect(uberDirectAdapter.parseWebhook("not json")).toBeNull();
    expect(uberDirectAdapter.parseWebhook(JSON.stringify({ status: "delivered" }))).toBeNull();
  });
});

describe("uberDirectAdapter.verifyWebhook", () => {
  beforeEach(() => {
    process.env.UBER_DIRECT_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.UBER_DIRECT_WEBHOOK_SECRET;
  });

  it("accepts a correctly signed body via the X-Postmates-Signature header", () => {
    const body = JSON.stringify({ delivery_id: "X", status: "delivered" });
    const headers = new Headers({ "x-postmates-signature": sign(body) });
    expect(uberDirectAdapter.verifyWebhook(body, headers)).toBe(true);
  });

  it("rejects a missing or wrong signature", () => {
    const body = JSON.stringify({ delivery_id: "X", status: "delivered" });
    expect(uberDirectAdapter.verifyWebhook(body, new Headers())).toBe(false);
    expect(
      uberDirectAdapter.verifyWebhook(body, new Headers({ "x-postmates-signature": "deadbeef" })),
    ).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    delete process.env.UBER_DIRECT_WEBHOOK_SECRET;
    const body = JSON.stringify({ delivery_id: "X", status: "delivered" });
    const headers = new Headers({ "x-postmates-signature": sign(body) });
    expect(uberDirectAdapter.verifyWebhook(body, headers)).toBe(false);
  });
});

describe("uberDirectAdapter.isConfigured", () => {
  afterEach(() => {
    delete process.env.UBER_DIRECT_CLIENT_ID;
    delete process.env.UBER_DIRECT_CLIENT_SECRET;
    delete process.env.UBER_DIRECT_CUSTOMER_ID;
  });

  it("is true only when client id, secret, and customer id are all present", () => {
    expect(uberDirectAdapter.isConfigured()).toBe(false);
    process.env.UBER_DIRECT_CLIENT_ID = "id";
    process.env.UBER_DIRECT_CLIENT_SECRET = "secret";
    expect(uberDirectAdapter.isConfigured()).toBe(false);
    process.env.UBER_DIRECT_CUSTOMER_ID = "cus_1";
    expect(uberDirectAdapter.isConfigured()).toBe(true);
  });
});
