import { afterEach, describe, expect, it } from "vitest";

import {
  AU_FALLBACK_CHAIN,
  MARKET_PRIMARY_COURIERS,
  resolveCourierChain,
  resolveCourierProvider,
} from "@/lib/courier";
import type { Market } from "@/lib/models";

/**
 * Phase M routing/fallback policy. `isConfigured()` is env-driven, so we toggle
 * the relevant credentials to mark each adapter live/dormant and assert the
 * resolved dispatch chain. The fallback policy lives here (rule #23), so this is
 * where it's covered.
 */

function configureLalamove() {
  process.env.LALAMOVE_API_KEY = "k";
  process.env.LALAMOVE_API_SECRET = "s";
}
function configureUber() {
  process.env.UBER_DIRECT_CLIENT_ID = "id";
  process.env.UBER_DIRECT_CLIENT_SECRET = "secret";
  process.env.UBER_DIRECT_CUSTOMER_ID = "cus";
}
function configureDoorDash() {
  process.env.DOORDASH_DRIVE_DEVELOPER_ID = "dev";
  process.env.DOORDASH_DRIVE_KEY_ID = "key";
  process.env.DOORDASH_DRIVE_SIGNING_SECRET = "sig";
}

function vendor(
  market: Market,
  courierProvider?: Parameters<typeof resolveCourierChain>[0]["courierProvider"],
) {
  return { market, courierProvider };
}

afterEach(() => {
  for (const key of [
    "LALAMOVE_API_KEY",
    "LALAMOVE_API_SECRET",
    "UBER_DIRECT_CLIENT_ID",
    "UBER_DIRECT_CLIENT_SECRET",
    "UBER_DIRECT_CUSTOMER_ID",
    "DOORDASH_DRIVE_DEVELOPER_ID",
    "DOORDASH_DRIVE_KEY_ID",
    "DOORDASH_DRIVE_SIGNING_SECRET",
  ]) {
    delete process.env[key];
  }
});

describe("market constants", () => {
  it("pins each market's primary and the AU fallback order", () => {
    expect(MARKET_PRIMARY_COURIERS.MY).toBe("lalamove");
    expect(MARKET_PRIMARY_COURIERS.AU).toBe("uber_direct");
    expect(AU_FALLBACK_CHAIN).toEqual(["uber_direct", "doordash_drive"]);
  });
});

describe("resolveCourierChain — MY market", () => {
  it("uses Lalamove when configured", () => {
    configureLalamove();
    expect(resolveCourierChain(vendor("MY"))).toEqual(["lalamove"]);
    expect(resolveCourierProvider(vendor("MY"))).toBe("lalamove");
  });

  it("falls back to manual when no MY courier is live", () => {
    expect(resolveCourierChain(vendor("MY"))).toEqual(["manual"]);
  });

  it("defaults an unset market to MY", () => {
    configureLalamove();
    expect(
      resolveCourierChain({ courierProvider: undefined } as Parameters<
        typeof resolveCourierChain
      >[0]),
    ).toEqual(["lalamove"]);
  });
});

describe("resolveCourierChain — AU market (primary + auto-fallback)", () => {
  it("returns Uber Direct then DoorDash when both are live", () => {
    configureUber();
    configureDoorDash();
    expect(resolveCourierChain(vendor("AU"))).toEqual(["uber_direct", "doordash_drive"]);
    expect(resolveCourierProvider(vendor("AU"))).toBe("uber_direct");
  });

  it("returns only Uber Direct when DoorDash is dormant (the launch posture)", () => {
    configureUber();
    expect(resolveCourierChain(vendor("AU"))).toEqual(["uber_direct"]);
  });

  it("falls through to DoorDash alone when Uber Direct is not configured", () => {
    configureDoorDash();
    expect(resolveCourierChain(vendor("AU"))).toEqual(["doordash_drive"]);
  });

  it("falls back to manual when no AU courier is live", () => {
    expect(resolveCourierChain(vendor("AU"))).toEqual(["manual"]);
  });
});

describe("resolveCourierChain — explicit vendor override", () => {
  it("manual always self-delivers regardless of market", () => {
    configureUber();
    expect(resolveCourierChain(vendor("AU", "manual"))).toEqual(["manual"]);
  });

  it("uses an explicit live provider alone, no fallback", () => {
    configureUber();
    expect(resolveCourierChain(vendor("MY", "uber_direct"))).toEqual(["uber_direct"]);
  });

  it("drops to manual when the explicit override is not configured", () => {
    expect(resolveCourierChain(vendor("AU", "uber_direct"))).toEqual(["manual"]);
  });
});
