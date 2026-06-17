import { describe, expect, it } from "vitest";

import {
  buildEnvelope,
  eventMatchesSubscription,
  generateWebhookSecret,
  nextAttemptAt,
  signWebhookBody,
  WEBHOOK_BACKOFF_MINUTES,
} from "@/lib/webhooks/signing";

describe("signWebhookBody", () => {
  it("is deterministic for the same secret, timestamp, and body", () => {
    const a = signWebhookBody("whsec_x", 1000, "{}");
    const b = signWebhookBody("whsec_x", 1000, "{}");
    expect(a).toBe(b);
    expect(a).toMatch(/^t=1000,v1=[0-9a-f]{64}$/);
  });

  it("changes when the secret, body, or timestamp changes", () => {
    const base = signWebhookBody("whsec_x", 1000, "{}");
    expect(signWebhookBody("whsec_y", 1000, "{}")).not.toBe(base);
    expect(signWebhookBody("whsec_x", 1001, "{}")).not.toBe(base);
    expect(signWebhookBody("whsec_x", 1000, '{"a":1}')).not.toBe(base);
  });
});

describe("generateWebhookSecret", () => {
  it("produces a prefixed, unique secret", () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[0-9a-f]+$/);
    expect(a).not.toBe(generateWebhookSecret());
  });
});

describe("eventMatchesSubscription", () => {
  it("matches everything when the filter is empty", () => {
    expect(eventMatchesSubscription({ eventTypes: [] }, "order.delivered")).toBe(true);
  });

  it("matches only listed types otherwise", () => {
    const sub = { eventTypes: ["order.delivered" as const] };
    expect(eventMatchesSubscription(sub, "order.delivered")).toBe(true);
    expect(eventMatchesSubscription(sub, "payout.released")).toBe(false);
  });
});

describe("nextAttemptAt", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("backs off further with each attempt and caps at the last step", () => {
    const first = nextAttemptAt(0, now).getTime() - now.getTime();
    const second = nextAttemptAt(1, now).getTime() - now.getTime();
    expect(second).toBeGreaterThan(first);
    expect(first).toBe(WEBHOOK_BACKOFF_MINUTES[0] * 60_000);

    const last = WEBHOOK_BACKOFF_MINUTES.length - 1;
    const capped = nextAttemptAt(last, now).getTime();
    expect(nextAttemptAt(last + 5, now).getTime()).toBe(capped);
  });
});

describe("buildEnvelope", () => {
  it("wraps the data with id, type, and an ISO timestamp", () => {
    const now = new Date("2026-06-15T08:30:00Z");
    const env = buildEnvelope("order.delivered:abc", "order.delivered", { id: "abc" }, now);
    expect(env).toEqual({
      id: "order.delivered:abc",
      type: "order.delivered",
      createdAt: "2026-06-15T08:30:00.000Z",
      data: { id: "abc" },
    });
  });
});
