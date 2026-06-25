import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { doordashDriveAdapter } from "@/lib/courier/doordash-drive";

const SECRET = "whsec_test_doordash";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("doordashDriveAdapter (dormant scaffold)", () => {
  afterEach(() => {
    delete process.env.DOORDASH_DRIVE_DEVELOPER_ID;
    delete process.env.DOORDASH_DRIVE_KEY_ID;
    delete process.env.DOORDASH_DRIVE_SIGNING_SECRET;
  });

  it("is not configured until all production credentials are present", () => {
    expect(doordashDriveAdapter.isConfigured()).toBe(false);
    process.env.DOORDASH_DRIVE_DEVELOPER_ID = "dev";
    process.env.DOORDASH_DRIVE_KEY_ID = "key";
    expect(doordashDriveAdapter.isConfigured()).toBe(false);
    process.env.DOORDASH_DRIVE_SIGNING_SECRET = "sig";
    expect(doordashDriveAdapter.isConfigured()).toBe(true);
  });

  it("throws on every network method while the API surface is unconfirmed", async () => {
    const stop = { address: "x", lat: 0, lng: 0 };
    await expect(doordashDriveAdapter.getQuote(stop, stop, { description: "c" })).rejects.toThrow(
      /dormant scaffold/i,
    );
    await expect(doordashDriveAdapter.getTracking("d1")).rejects.toThrow(/dormant scaffold/i);
    await expect(doordashDriveAdapter.cancel("d1")).rejects.toThrow(/dormant scaffold/i);
  });
});

describe("doordashDriveAdapter.parseWebhook (wired ahead of go-live)", () => {
  it("parses a delivery-status event onto the neutral state machine", () => {
    const event = doordashDriveAdapter.parseWebhook(
      JSON.stringify({ external_delivery_id: "dd_1", delivery_status: "picked_up" }),
    );
    expect(event?.courierOrderId).toBe("dd_1");
    expect(event?.deliveryStatus).toBe("picked_up");
  });

  it("returns null without a delivery ref", () => {
    expect(doordashDriveAdapter.parseWebhook(JSON.stringify({ status: "delivered" }))).toBeNull();
    expect(doordashDriveAdapter.parseWebhook("not json")).toBeNull();
  });
});

describe("doordashDriveAdapter.verifyWebhook", () => {
  beforeEach(() => {
    process.env.DOORDASH_DRIVE_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.DOORDASH_DRIVE_WEBHOOK_SECRET;
  });

  it("accepts a correctly signed body and rejects everything else", () => {
    const body = JSON.stringify({ external_delivery_id: "X", delivery_status: "delivered" });
    expect(
      doordashDriveAdapter.verifyWebhook(body, new Headers({ "x-doordash-signature": sign(body) })),
    ).toBe(true);
    expect(doordashDriveAdapter.verifyWebhook(body, new Headers())).toBe(false);
  });

  it("fails closed (rejects all) while dormant with no secret set", () => {
    delete process.env.DOORDASH_DRIVE_WEBHOOK_SECRET;
    const body = JSON.stringify({ external_delivery_id: "X", delivery_status: "delivered" });
    expect(
      doordashDriveAdapter.verifyWebhook(body, new Headers({ "x-doordash-signature": sign(body) })),
    ).toBe(false);
  });
});
