import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lalamoveAdapter } from "@/lib/courier/lalamove";

const SECRET = "whsec_test_lalamove";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("lalamoveAdapter.parseWebhook", () => {
  it("parses an ORDER_STATUS_CHANGED payload into the neutral event", () => {
    const body = JSON.stringify({
      timestamp: 1_700_000_000_000,
      eventType: "ORDER_STATUS_CHANGED",
      data: { order: { orderId: "LM-123", status: "PICKED_UP" } },
    });
    const event = lalamoveAdapter.parseWebhook(body);
    expect(event).not.toBeNull();
    expect(event?.courierOrderId).toBe("LM-123");
    expect(event?.rawStatus).toBe("PICKED_UP");
    expect(event?.deliveryStatus).toBe("picked_up");
    expect(event?.eventAt.getTime()).toBe(1_700_000_000_000);
  });

  it("extracts driver identity and location from a DRIVER_ASSIGNED payload", () => {
    const body = JSON.stringify({
      timestamp: 1_700_000_500_000,
      eventType: "DRIVER_ASSIGNED",
      data: {
        order: { orderId: "LM-9", status: "ON_GOING" },
        driver: {
          name: "Aiman",
          phone: "+60123",
          plateNumber: "WXY 1234",
          location: { lat: "3.139", lng: "101.6869" },
        },
      },
    });
    const event = lalamoveAdapter.parseWebhook(body);
    expect(event?.deliveryStatus).toBeNull(); // ON_GOING is info-only
    expect(event?.driver).toEqual({ name: "Aiman", phone: "+60123", plate: "WXY 1234" });
    expect(event?.lat).toBeCloseTo(3.139);
    expect(event?.lng).toBeCloseTo(101.6869);
  });

  it("maps COMPLETED → delivered and CANCELED → failed", () => {
    const done = lalamoveAdapter.parseWebhook(
      JSON.stringify({ data: { orderId: "A", status: "COMPLETED" } }),
    );
    expect(done?.deliveryStatus).toBe("delivered");
    const cancelled = lalamoveAdapter.parseWebhook(
      JSON.stringify({ data: { orderId: "A", status: "CANCELED" } }),
    );
    expect(cancelled?.deliveryStatus).toBe("failed");
  });

  it("returns null for an unparseable body or a payload without an order ref", () => {
    expect(lalamoveAdapter.parseWebhook("not json")).toBeNull();
    expect(
      lalamoveAdapter.parseWebhook(JSON.stringify({ data: { status: "COMPLETED" } })),
    ).toBeNull();
  });
});

describe("lalamoveAdapter.verifyWebhook", () => {
  beforeEach(() => {
    process.env.LALAMOVE_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.LALAMOVE_WEBHOOK_SECRET;
    delete process.env.LALAMOVE_API_SECRET;
  });

  it("accepts a correctly signed body via the signature header", () => {
    const body = JSON.stringify({ data: { orderId: "X", status: "COMPLETED" } });
    const headers = new Headers({ "x-lalamove-signature": sign(body) });
    expect(lalamoveAdapter.verifyWebhook(body, headers)).toBe(true);
  });

  it("rejects when no signature header is present", () => {
    const body = JSON.stringify({ data: { orderId: "X", status: "COMPLETED" } });
    expect(lalamoveAdapter.verifyWebhook(body, new Headers())).toBe(false);
  });

  it("rejects a wrong signature", () => {
    const body = JSON.stringify({ data: { orderId: "X", status: "COMPLETED" } });
    const headers = new Headers({ "x-lalamove-signature": "deadbeef" });
    expect(lalamoveAdapter.verifyWebhook(body, headers)).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    delete process.env.LALAMOVE_WEBHOOK_SECRET;
    const body = JSON.stringify({ data: { orderId: "X", status: "COMPLETED" } });
    const headers = new Headers({ "x-lalamove-signature": sign(body) });
    expect(lalamoveAdapter.verifyWebhook(body, headers)).toBe(false);
  });
});

describe("lalamoveAdapter.isConfigured", () => {
  afterEach(() => {
    delete process.env.LALAMOVE_API_KEY;
    delete process.env.LALAMOVE_API_SECRET;
  });

  it("is true only when both API key and secret are present", () => {
    expect(lalamoveAdapter.isConfigured()).toBe(false);
    process.env.LALAMOVE_API_KEY = "k";
    expect(lalamoveAdapter.isConfigured()).toBe(false);
    process.env.LALAMOVE_API_SECRET = "s";
    expect(lalamoveAdapter.isConfigured()).toBe(true);
  });
});
