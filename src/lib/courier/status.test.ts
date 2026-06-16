import { describe, expect, it } from "vitest";

import {
  isForwardTransition,
  isTerminalStatus,
  mapCourierStatus,
  mapLalamoveStatus,
  priorStatesFor,
  shouldApplyTransition,
} from "@/lib/courier/status";

describe("mapLalamoveStatus", () => {
  it("maps terminal and pickup statuses onto the Delivery state machine", () => {
    expect(mapLalamoveStatus("PICKED_UP")).toBe("picked_up");
    expect(mapLalamoveStatus("COMPLETED")).toBe("delivered");
    expect(mapLalamoveStatus("CANCELED")).toBe("failed");
    expect(mapLalamoveStatus("CANCELLED")).toBe("failed");
    expect(mapLalamoveStatus("REJECTED")).toBe("failed");
    expect(mapLalamoveStatus("EXPIRED")).toBe("failed");
  });

  it("is case-insensitive", () => {
    expect(mapLalamoveStatus("completed")).toBe("delivered");
  });

  it("returns null for info-only statuses (no transition)", () => {
    expect(mapLalamoveStatus("ASSIGNING_DRIVER")).toBeNull();
    expect(mapLalamoveStatus("ON_GOING")).toBeNull();
    expect(mapLalamoveStatus("PENDING")).toBeNull();
    expect(mapLalamoveStatus("WHATEVER")).toBeNull();
  });

  it("reuses the mapping for grab, and never transitions for manual", () => {
    expect(mapCourierStatus("grab", "COMPLETED")).toBe("delivered");
    expect(mapCourierStatus("manual", "COMPLETED")).toBeNull();
  });
});

describe("isForwardTransition", () => {
  it("advances along pending → assigned → picked_up → delivered", () => {
    expect(isForwardTransition("pending", "assigned")).toBe(true);
    expect(isForwardTransition("assigned", "picked_up")).toBe(true);
    expect(isForwardTransition("picked_up", "delivered")).toBe(true);
  });

  it("never moves backwards or sideways", () => {
    expect(isForwardTransition("picked_up", "assigned")).toBe(false);
    expect(isForwardTransition("delivered", "delivered")).toBe(false);
    expect(isForwardTransition("delivered", "failed")).toBe(false);
  });
});

describe("priorStatesFor", () => {
  it("lists exactly the states that may advance to the target", () => {
    expect(priorStatesFor("delivered").sort()).toEqual(["assigned", "pending", "picked_up"].sort());
    expect(priorStatesFor("picked_up").sort()).toEqual(["assigned", "pending"].sort());
    expect(priorStatesFor("assigned")).toEqual(["pending"]);
  });
});

describe("shouldApplyTransition (out-of-order + retry safety)", () => {
  it("advances and re-applies the same non-terminal state", () => {
    expect(shouldApplyTransition("assigned", "picked_up")).toBe(true);
    expect(shouldApplyTransition("picked_up", "picked_up")).toBe(true); // dup; claim dedups
  });

  it("ignores backward / stale events", () => {
    expect(shouldApplyTransition("picked_up", "assigned")).toBe(false);
  });

  it("re-applies the same terminal state (lets a failed-then-retried event reprocess)", () => {
    expect(shouldApplyTransition("delivered", "delivered")).toBe(true);
    expect(shouldApplyTransition("failed", "failed")).toBe(true);
  });

  it("never leaves a terminal state for a different one", () => {
    expect(shouldApplyTransition("delivered", "failed")).toBe(false);
    expect(shouldApplyTransition("failed", "delivered")).toBe(false);
    expect(shouldApplyTransition("delivered", "picked_up")).toBe(false);
  });

  it("knows which states are terminal", () => {
    expect(isTerminalStatus("delivered")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("picked_up")).toBe(false);
  });
});
