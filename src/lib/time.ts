/**
 * The single timezone-aware scheduling module (critical rule #5).
 *
 * All timestamps in the database are UTC `Date`s. "Local" here always means
 * Asia/Kuala_Lumpur, which is fixed at UTC+8 with no daylight saving — so
 * local↔UTC conversion is a constant offset, verified by tests.
 */

export const TIMEZONE = "Asia/Kuala_Lumpur";
export const UTC_OFFSET_HOURS = 8;

/** Business times, confirmed 2026-06-09: night-before notification at
 * 20:00 local; orders lock (and quota decrements) at 06:00 local. */
export const NOTIFY_LOCAL_TIME = "20:00";
export const CUTOFF_LOCAL_TIME = "06:00";

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The KL calendar date (YYYY-MM-DD) of a UTC instant. */
export function localDateOf(instant: Date): string {
  const shifted = new Date(instant.getTime() + UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** The KL wall-clock time (HH:mm) of a UTC instant. */
export function localTimeOf(instant: Date): string {
  const shifted = new Date(instant.getTime() + UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return shifted.toISOString().slice(11, 16);
}

/** The KL date one day after the KL date of `now`. */
export function tomorrowLocalDate(now: Date): string {
  return addDaysLocal(localDateOf(now), 1);
}

/** Add days to a local date string, calendar-safe. */
export function addDaysLocal(localDate: string, days: number): string {
  assertLocalDate(localDate);
  const [y, m, d] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekdayOf(localDate: string): number {
  assertLocalDate(localDate);
  const [y, m, d] = localDate.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return jsDay === 0 ? 7 : jsDay;
}

/** The UTC instant of a KL wall-clock time on a KL date. */
export function utcInstantOfLocal(localDate: string, localTime: string): Date {
  assertLocalDate(localDate);
  if (!LOCAL_TIME_RE.test(localTime)) {
    throw new Error(`Invalid local time: ${localTime} (expected HH:mm)`);
  }
  const [y, m, d] = localDate.split("-").map(Number);
  const [hh, mm] = localTime.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - UTC_OFFSET_HOURS, mm));
}

/** Cutoff instant (06:00 KL) for an order delivered on `localDate`. */
export function cutoffInstantFor(localDate: string): Date {
  return utcInstantOfLocal(localDate, CUTOFF_LOCAL_TIME);
}

/** "08:15" → "8:15 AM" for human-facing copy. */
export function formatLocalTime12h(localTime: string): string {
  if (!LOCAL_TIME_RE.test(localTime)) {
    throw new Error(`Invalid local time: ${localTime} (expected HH:mm)`);
  }
  const [hh, mm] = localTime.split(":").map(Number);
  const suffix = hh < 12 ? "AM" : "PM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour12}:${mm.toString().padStart(2, "0")} ${suffix}`;
}

function assertLocalDate(localDate: string): void {
  if (!LOCAL_DATE_RE.test(localDate)) {
    throw new Error(`Invalid local date: ${localDate} (expected YYYY-MM-DD)`);
  }
}
