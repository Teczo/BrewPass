import type { WeatherCondition } from "@/lib/weather";

/**
 * Phase 8 rule engine — pure and unit-tested. Reads the append-only
 * PreferenceSignal history and proposes a change for tomorrow's order.
 * Suggestions are ADVISORY ONLY: they're attached to the order and the
 * notification, and applied solely through the normal user-confirmed
 * modify flow. Nothing here ever changes an order.
 */

/** Flattened view of a PreferenceSignal, decoupled from the DB schema. */
export interface SignalLike {
  weekday: number;
  weather?: string;
  locationLabel?: string;
  drink: string;
}

export interface DrinkSuggestion {
  kind: "drink";
  drink: string;
  reason: "rain" | "weekday";
  message: string;
}

export interface LocationSuggestion {
  kind: "location";
  locationLabel: string;
  reason: "location";
  message: string;
}

export type Suggestion = DrinkSuggestion | LocationSuggestion;

/** Patterns need at least this many matching signals… */
export const MIN_OCCURRENCES = 3;
/** …and the dominant choice must cover at least this share of them. */
export const DOMINANCE_THRESHOLD = 0.6;

const WEEKDAY_NAMES = [
  "",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
];

/** The most frequent value among signals, if it clears both thresholds. */
function dominantValue(values: string[]): string | null {
  if (values.length < MIN_OCCURRENCES) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best !== null && bestCount / values.length >= DOMINANCE_THRESHOLD ? best : null;
}

/**
 * Suggest a drink swap for tomorrow. Rain patterns win over weekday
 * patterns (more specific context), and a suggestion matching what's
 * already ordered is suppressed.
 */
export function suggestDrink(args: {
  signals: SignalLike[];
  targetWeekday: number;
  tomorrowWeather: WeatherCondition;
  currentDrink: string;
}): DrinkSuggestion | null {
  const { signals, targetWeekday, tomorrowWeather, currentDrink } = args;

  if (tomorrowWeather === "rain") {
    const rainy = dominantValue(
      signals.filter((signal) => signal.weather === "rain").map((signal) => signal.drink),
    );
    if (rainy && rainy !== currentDrink) {
      return {
        kind: "drink",
        drink: rainy,
        reason: "rain",
        message: `Rain expected tomorrow — you usually go for a ${rainy} on rainy days. Switch?`,
      };
    }
  }

  const weekday = dominantValue(
    signals.filter((signal) => signal.weekday === targetWeekday).map((signal) => signal.drink),
  );
  if (weekday && weekday !== currentDrink) {
    return {
      kind: "drink",
      drink: weekday,
      reason: "weekday",
      message: `You usually order a ${weekday} on ${WEEKDAY_NAMES[targetWeekday]}. Switch tomorrow?`,
    };
  }

  return null;
}

/**
 * Routine detection: if the user keeps redirecting this weekday's coffee
 * to a different location than tomorrow's snapshot, surface it.
 */
export function suggestLocation(args: {
  signals: SignalLike[];
  targetWeekday: number;
  currentLocationLabel: string;
}): LocationSuggestion | null {
  const { signals, targetWeekday, currentLocationLabel } = args;

  const label = dominantValue(
    signals
      .filter((signal) => signal.weekday === targetWeekday && signal.locationLabel)
      .map((signal) => signal.locationLabel as string),
  );
  if (label && label !== currentLocationLabel) {
    return {
      kind: "location",
      locationLabel: label,
      reason: "location",
      message: `Your ${WEEKDAY_NAMES[targetWeekday].replace(/s$/, "")} coffees usually go to ${label} — update tomorrow's delivery?`,
    };
  }
  return null;
}

/** The single suggestion to surface: a drink swap beats a location nudge. */
export function pickSuggestion(args: {
  signals: SignalLike[];
  targetWeekday: number;
  tomorrowWeather: WeatherCondition;
  currentDrink: string;
  currentLocationLabel: string;
}): Suggestion | null {
  return (
    suggestDrink(args) ??
    suggestLocation({
      signals: args.signals,
      targetWeekday: args.targetWeekday,
      currentLocationLabel: args.currentLocationLabel,
    })
  );
}
