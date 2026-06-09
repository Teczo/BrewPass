import { describe, expect, it } from "vitest";

import {
  addDaysLocal,
  cutoffInstantFor,
  formatLocalTime12h,
  isoWeekdayOf,
  localDateOf,
  localTimeOf,
  tomorrowLocalDate,
  utcInstantOfLocal,
} from "@/lib/time";

describe("localDateOf", () => {
  it("converts a UTC instant to the KL calendar date", () => {
    // 2026-06-09 17:00 UTC = 2026-06-10 01:00 KL
    expect(localDateOf(new Date("2026-06-09T17:00:00Z"))).toBe("2026-06-10");
  });

  it("stays on the same date before the KL midnight boundary", () => {
    // 2026-06-09 15:59 UTC = 2026-06-09 23:59 KL
    expect(localDateOf(new Date("2026-06-09T15:59:00Z"))).toBe("2026-06-09");
  });

  it("crosses month and year boundaries correctly", () => {
    // Dec 31 16:00 UTC = Jan 1 00:00 KL
    expect(localDateOf(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
});

describe("localTimeOf", () => {
  it("returns the KL wall-clock time of a UTC instant", () => {
    expect(localTimeOf(new Date("2026-06-10T00:00:00Z"))).toBe("08:00");
    expect(localTimeOf(new Date("2026-06-09T22:30:00Z"))).toBe("06:30");
  });
});

describe("tomorrowLocalDate", () => {
  it("is the next KL date, judged in KL time", () => {
    // At 20:00 KL on June 9 (12:00 UTC), tomorrow is June 10.
    expect(tomorrowLocalDate(new Date("2026-06-09T12:00:00Z"))).toBe("2026-06-10");
    // At 01:00 KL on June 10 (17:00 UTC June 9), tomorrow is June 11.
    expect(tomorrowLocalDate(new Date("2026-06-09T17:00:00Z"))).toBe("2026-06-11");
  });
});

describe("addDaysLocal", () => {
  it("handles month ends and leap years", () => {
    expect(addDaysLocal("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysLocal("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addDaysLocal("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("isoWeekdayOf", () => {
  it("maps Monday to 1 and Sunday to 7", () => {
    expect(isoWeekdayOf("2026-06-08")).toBe(1); // Monday
    expect(isoWeekdayOf("2026-06-12")).toBe(5); // Friday
    expect(isoWeekdayOf("2026-06-14")).toBe(7); // Sunday
  });
});

describe("utcInstantOfLocal", () => {
  it("converts KL wall-clock to the UTC instant 8 hours earlier", () => {
    expect(utcInstantOfLocal("2026-06-10", "08:00").toISOString()).toBe("2026-06-10T00:00:00.000Z");
  });

  it("rolls to the previous UTC day for early KL mornings", () => {
    expect(utcInstantOfLocal("2026-06-10", "06:00").toISOString()).toBe("2026-06-09T22:00:00.000Z");
  });

  it("rejects malformed input", () => {
    expect(() => utcInstantOfLocal("2026-6-1", "08:00")).toThrow();
    expect(() => utcInstantOfLocal("2026-06-10", "8am")).toThrow();
  });
});

describe("cutoffInstantFor", () => {
  it("is 06:00 KL = 22:00 UTC the previous day", () => {
    expect(cutoffInstantFor("2026-06-10").toISOString()).toBe("2026-06-09T22:00:00.000Z");
  });
});

describe("formatLocalTime12h", () => {
  it("formats morning, noon, and midnight", () => {
    expect(formatLocalTime12h("08:00")).toBe("8:00 AM");
    expect(formatLocalTime12h("12:30")).toBe("12:30 PM");
    expect(formatLocalTime12h("00:15")).toBe("12:15 AM");
    expect(formatLocalTime12h("20:00")).toBe("8:00 PM");
  });
});
