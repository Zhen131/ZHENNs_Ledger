import type { TimePrecision } from "@/core/models";

import { resolveWallTimeInTimeZone } from "./timeZone";

/**
 * The short list of places a fact can be recorded in, beside the device's own.
 * Deliberately short and deliberately not remembered between entries.
 */
export const FACT_TIME_ZONE_OPTIONS = [
  "Asia/Shanghai",
  "Europe/Budapest",
  "UTC",
] as const;

export type FactMomentDraft = Readonly<{
  occurredAt: string;
  timePrecision: TimePrecision;
  occurredTimeZone?: string;
}>;

export function isTimePrecision(value: unknown): value is TimePrecision {
  return value === "day" || value === "minute" || value === "second";
}

export type FactMomentRejection = "nonexistent" | "ambiguous" | "invalid";

export type FactMomentResult =
  | Readonly<{ ok: true; value: FactMomentDraft }>
  | Readonly<{ ok: false; reason: FactMomentRejection }>;

/**
 * Turns what a recording form holds — a date, an optional wall-clock time, and
 * the place that time was read in — into the moment a fact is stored with.
 *
 * Leaving the time empty keeps the fact on the day it already was: a bare date,
 * no place, day precision. That path is what every fact recorded before times
 * existed produced, and it must stay byte-for-byte the same.
 *
 * A filled time is resolved against the place. On the two days a year a place
 * moves its clocks, a wall time can name no moment at all or two of them; both
 * are refused rather than guessed at, because either guess would store
 * something the person did not write.
 */
export function resolveFactMoment(
  date: string,
  time: string,
  timeZone: string,
): FactMomentResult {
  if (time === "") {
    return { ok: true, value: { occurredAt: date, timePrecision: "day" } };
  }

  if (!/^\d{2}:\d{2}$/.test(time) || timeZone === "") {
    return { ok: false, reason: "invalid" };
  }

  try {
    const wallTime = `${date}T${time}:00`;
    const candidates = resolveWallTimeInTimeZone(wallTime, timeZone);
    if (candidates.length === 0) return { ok: false, reason: "nonexistent" };
    if (candidates.length !== 1) return { ok: false, reason: "ambiguous" };
    return {
      ok: true,
      value: {
        occurredAt: `${wallTime}${candidates[0].offset}`,
        occurredTimeZone: timeZone,
        timePrecision: "minute",
      },
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
