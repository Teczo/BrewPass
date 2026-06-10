import { describe, expect, it } from "vitest";

import {
  MIN_OCCURRENCES,
  pickSuggestion,
  suggestDrink,
  suggestLocation,
  type SignalLike,
} from "@/lib/suggestions";

function signal(overrides: Partial<SignalLike>): SignalLike {
  return { weekday: 3, drink: "Flat White", ...overrides };
}

const MONDAY = 1;
const WEDNESDAY = 3;

describe("suggestDrink — weekday patterns (8a)", () => {
  it("suggests the dominant weekday drink when it differs from the order", () => {
    const signals = [
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
      signal({ weekday: MONDAY, drink: "Latte" }),
      signal({ weekday: WEDNESDAY, drink: "Latte" }),
    ];
    const result = suggestDrink({
      signals,
      targetWeekday: MONDAY,
      tomorrowWeather: "clear",
      currentDrink: "Flat White",
    });
    expect(result?.drink).toBe("Double Espresso");
    expect(result?.reason).toBe("weekday");
    expect(result?.message).toContain("Mondays");
  });

  it("needs at least MIN_OCCURRENCES signals on that weekday", () => {
    const signals = Array.from({ length: MIN_OCCURRENCES - 1 }, () =>
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
    );
    expect(
      suggestDrink({
        signals,
        targetWeekday: MONDAY,
        tomorrowWeather: "clear",
        currentDrink: "Flat White",
      }),
    ).toBeNull();
  });

  it("stays quiet when no drink dominates (below 60%)", () => {
    const signals = [
      signal({ weekday: MONDAY, drink: "Mocha" }),
      signal({ weekday: MONDAY, drink: "Latte" }),
      signal({ weekday: MONDAY, drink: "Mocha" }),
      signal({ weekday: MONDAY, drink: "Americano" }),
    ];
    expect(
      suggestDrink({
        signals,
        targetWeekday: MONDAY,
        tomorrowWeather: "clear",
        currentDrink: "Flat White",
      }),
    ).toBeNull();
  });

  it("never suggests what the order already is", () => {
    const signals = [
      signal({ weekday: MONDAY, drink: "Flat White" }),
      signal({ weekday: MONDAY, drink: "Flat White" }),
      signal({ weekday: MONDAY, drink: "Flat White" }),
    ];
    expect(
      suggestDrink({
        signals,
        targetWeekday: MONDAY,
        tomorrowWeather: "clear",
        currentDrink: "Flat White",
      }),
    ).toBeNull();
  });
});

describe("suggestDrink — rain patterns (8b)", () => {
  const rainHistory = [
    signal({ weekday: MONDAY, weather: "rain", drink: "Hot Latte" }),
    signal({ weekday: WEDNESDAY, weather: "rain", drink: "Hot Latte" }),
    signal({ weekday: 5, weather: "rain", drink: "Hot Latte" }),
    signal({ weekday: MONDAY, weather: "clear", drink: "Americano" }),
  ];

  it("suggests the rainy-day drink when rain is forecast", () => {
    const result = suggestDrink({
      signals: rainHistory,
      targetWeekday: MONDAY,
      tomorrowWeather: "rain",
      currentDrink: "Flat White",
    });
    expect(result?.drink).toBe("Hot Latte");
    expect(result?.reason).toBe("rain");
    expect(result?.message).toContain("Rain expected");
  });

  it("ignores rain history when tomorrow is clear or unknown", () => {
    for (const weather of ["clear", "unknown"] as const) {
      const result = suggestDrink({
        signals: rainHistory,
        targetWeekday: WEDNESDAY,
        tomorrowWeather: weather,
        currentDrink: "Flat White",
      });
      expect(result?.reason).not.toBe("rain");
    }
  });

  it("prefers the rain pattern over the weekday pattern", () => {
    const signals = [
      ...rainHistory,
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
      signal({ weekday: MONDAY, drink: "Double Espresso" }),
    ];
    const result = suggestDrink({
      signals,
      targetWeekday: MONDAY,
      tomorrowWeather: "rain",
      currentDrink: "Flat White",
    });
    expect(result?.reason).toBe("rain");
    expect(result?.drink).toBe("Hot Latte");
  });
});

describe("suggestLocation — routine detection", () => {
  it("notices a weekday location habit that differs from the snapshot", () => {
    const signals = [
      signal({ weekday: WEDNESDAY, locationLabel: "Home" }),
      signal({ weekday: WEDNESDAY, locationLabel: "Home" }),
      signal({ weekday: WEDNESDAY, locationLabel: "Home" }),
      signal({ weekday: MONDAY, locationLabel: "Office" }),
    ];
    const result = suggestLocation({
      signals,
      targetWeekday: WEDNESDAY,
      currentLocationLabel: "Office",
    });
    expect(result?.locationLabel).toBe("Home");
    expect(result?.message).toContain("Home");
  });

  it("stays quiet when the habit matches the snapshot already", () => {
    const signals = [
      signal({ weekday: WEDNESDAY, locationLabel: "Office" }),
      signal({ weekday: WEDNESDAY, locationLabel: "Office" }),
      signal({ weekday: WEDNESDAY, locationLabel: "Office" }),
    ];
    expect(
      suggestLocation({
        signals,
        targetWeekday: WEDNESDAY,
        currentLocationLabel: "Office",
      }),
    ).toBeNull();
  });
});

describe("pickSuggestion", () => {
  it("prefers a drink swap over a location nudge", () => {
    const signals = [
      signal({ weekday: MONDAY, drink: "Mocha", locationLabel: "Home" }),
      signal({ weekday: MONDAY, drink: "Mocha", locationLabel: "Home" }),
      signal({ weekday: MONDAY, drink: "Mocha", locationLabel: "Home" }),
    ];
    const result = pickSuggestion({
      signals,
      targetWeekday: MONDAY,
      tomorrowWeather: "clear",
      currentDrink: "Flat White",
      currentLocationLabel: "Office",
    });
    expect(result?.kind).toBe("drink");
  });

  it("falls back to the location nudge when drinks already match", () => {
    const signals = [
      signal({ weekday: MONDAY, drink: "Flat White", locationLabel: "Home" }),
      signal({ weekday: MONDAY, drink: "Flat White", locationLabel: "Home" }),
      signal({ weekday: MONDAY, drink: "Flat White", locationLabel: "Home" }),
    ];
    const result = pickSuggestion({
      signals,
      targetWeekday: MONDAY,
      tomorrowWeather: "clear",
      currentDrink: "Flat White",
      currentLocationLabel: "Office",
    });
    expect(result?.kind).toBe("location");
  });

  it("returns null with no history at all", () => {
    expect(
      pickSuggestion({
        signals: [],
        targetWeekday: MONDAY,
        tomorrowWeather: "rain",
        currentDrink: "Flat White",
        currentLocationLabel: "Office",
      }),
    ).toBeNull();
  });
});
