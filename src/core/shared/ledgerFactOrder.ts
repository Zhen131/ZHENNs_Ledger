import { getLedgerDateKey } from "./ledgerDate";

export type LedgerFactOrderKind =
  | "trade"
  | "cash-event"
  | "asset-transfer"
  | "price-snapshot";

/**
 * The single ordering input every ledger fact is projected onto before two
 * facts are compared. Optional members exist because the array-index tiebreak
 * never reads them.
 */
export type LedgerFactOrderInput = Readonly<{
  occurredAt: string;
  createdAt?: string;
  kind?: LedgerFactOrderKind;
  id?: string;
  /** Only read by the "array-index" tiebreak. */
  arrayIndex?: number;
}>;

/**
 * Which rule breaks a tie once the local date and the real instant are equal.
 *
 * - "record" compares createdAt, then trades before non-trades, then id.
 * - "array-index" compares the caller-supplied array positions, so its result
 *   depends on the order the caller passed the facts in.
 */
export type LedgerFactOrderTiebreak = "record" | "array-index";

/**
 * The only ledger fact ordering rule in the repository. Every call site that
 * decides which of two facts comes first goes through this function.
 */
export function compareLedgerFactOrder(
  left: LedgerFactOrderInput,
  right: LedgerFactOrderInput,
  tiebreak: LedgerFactOrderTiebreak = "record",
): number {
  const leftDate = getLedgerDateKey(left.occurredAt);
  const rightDate = getLedgerDateKey(right.occurredAt);
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1;
  }

  if (left.occurredAt.length > 10 && right.occurredAt.length > 10) {
    const instantOrder =
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    if (instantOrder !== 0) {
      return instantOrder;
    }
  }

  return tiebreak === "array-index"
    ? (left.arrayIndex ?? 0) - (right.arrayIndex ?? 0)
    : compareLedgerFactRecordTiebreak(left, right);
}

function compareLedgerFactRecordTiebreak(
  left: LedgerFactOrderInput,
  right: LedgerFactOrderInput,
): number {
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
