import type { PriceSnapshot } from "@/core/models";

import { getLedgerDateKey } from "./ledgerDate";
import { resolveWallTimeInTimeZone } from "./timeZone";

export type LedgerFactOrderKind =
  | "trade"
  | "cash-event"
  | "asset-transfer"
  | "price-snapshot";

/**
 * The single ordering input every ledger fact is projected onto before two
 * facts are compared.
 */
export type LedgerFactOrderInput = Readonly<{
  occurredAt: string;
  occurredTimeZone?: string;
  createdAt?: string;
  kind?: LedgerFactOrderKind;
  id?: string;
}>;

const FALLBACK_ORDER_TIME_ZONE = "UTC";
const MINUTES_SCANNED_FOR_A_MISSING_LOCAL_MIDNIGHT = 4 * 60;

/**
 * Local day starts are stable for a given date and zone, and resolving one
 * costs many Intl formats, so they are memoised. This does not make the
 * function impure: the same date and zone always produce the same instant.
 */
const localDayStartInstants = new Map<string, number>();

/**
 * The instant a fact is ordered by.
 *
 * A fact recorded down to the minute is ordered by its own instant. A fact
 * recorded only to the day is ordered as the start of that day in the place it
 * happened, or in UTC when no place was recorded. Placing it at the start of
 * the day lets the timed facts of the same day settle after it.
 *
 * This is a pure function of the fact alone: it reads neither the device time
 * zone, nor the current time, nor the order the caller passed facts in.
 */
export function getLedgerFactSortInstant(fact: LedgerFactOrderInput): number {
  if (fact.occurredAt.length > 10) {
    return Date.parse(fact.occurredAt);
  }

  return getLocalDayStartInstant(
    getLedgerDateKey(fact.occurredAt),
    fact.occurredTimeZone ?? FALLBACK_ORDER_TIME_ZONE,
  );
}

/**
 * The only ledger fact ordering rule in the repository. Every call site that
 * decides which of two facts comes first goes through this function.
 *
 * The result never depends on the order the facts were passed in.
 */
export function compareLedgerFactOrder(
  left: LedgerFactOrderInput,
  right: LedgerFactOrderInput,
): number {
  const instantOrder =
    getLedgerFactSortInstant(left) - getLedgerFactSortInstant(right);
  if (instantOrder !== 0) {
    return instantOrder;
  }

  if (left.createdAt !== undefined && right.createdAt !== undefined) {
    const createdAtOrder =
      Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (createdAtOrder !== 0) {
      return createdAtOrder;
    }
  }

  if (left.kind !== right.kind) {
    if (left.kind === "trade") return -1;
    if (right.kind === "trade") return 1;
  }

  return (left.id ?? "").localeCompare(right.id ?? "", "en");
}

/**
 * Price snapshots name their moment `recordedAt`; every other fact names it
 * `occurredAt`. This is the one place that difference is bridged.
 */
export function toPriceSnapshotOrderInput(
  snapshot: PriceSnapshot,
): LedgerFactOrderInput {
  return {
    occurredAt: snapshot.recordedAt,
    ...(snapshot.occurredTimeZone === undefined
      ? {}
      : { occurredTimeZone: snapshot.occurredTimeZone }),
    createdAt: snapshot.createdAt,
    kind: "price-snapshot",
    id: snapshot.id,
  };
}

function getLocalDayStartInstant(dateKey: string, timeZone: string): number {
  const utcMidnight = Date.parse(`${dateKey}T00:00:00Z`);
  if (timeZone === FALLBACK_ORDER_TIME_ZONE) {
    return utcMidnight;
  }

  const cacheKey = `${dateKey} ${timeZone}`;
  const cached = localDayStartInstants.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const resolved =
    resolveLocalDayStartInstant(dateKey, timeZone) ?? utcMidnight;
  localDayStartInstants.set(cacheKey, resolved);
  return resolved;
}

/**
 * Local midnight does not exist in every zone on every day: a few zones move
 * their clocks forward at midnight, which skips it. The day still begins, so
 * the first local wall time that does exist is used. Ordering must never throw,
 * so an unusable zone falls back to the caller's UTC midnight.
 */
function resolveLocalDayStartInstant(
  dateKey: string,
  timeZone: string,
): number | undefined {
  try {
    for (
      let minute = 0;
      minute <= MINUTES_SCANNED_FOR_A_MISSING_LOCAL_MIDNIGHT;
      minute += 1
    ) {
      const hours = String(Math.floor(minute / 60)).padStart(2, "0");
      const minutes = String(minute % 60).padStart(2, "0");
      const candidates = resolveWallTimeInTimeZone(
        `${dateKey}T${hours}:${minutes}:00`,
        timeZone,
      );
      if (candidates.length > 0) {
        return candidates[0].instant.getTime();
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
