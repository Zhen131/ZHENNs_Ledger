import { describe, expect, it } from "vitest";

import { compareLedgerFactOrder } from "./ledgerFactOrder";

describe("ledgerFactOrder array-index tiebreak", () => {
  it("sorts different days by source date key", () => {
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T23:30:00-10:00", arrayIndex: 0 },
        { occurredAt: "2026-07-26T00:01:00+14:00", arrayIndex: 1 },
        "array-index",
      ),
    ).toBeLessThan(0);
  });

  it("uses real instants only when both same-day facts have datetimes", () => {
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T12:00:00+08:00", arrayIndex: 0 },
        { occurredAt: "2026-07-25T05:00:00Z", arrayIndex: 1 },
        "array-index",
      ),
    ).toBeLessThan(0);
  });

  it("keeps array order for date-only mixtures and equal instants", () => {
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T23:00:00+08:00", arrayIndex: 0 },
        { occurredAt: "2026-07-25", arrayIndex: 1 },
        "array-index",
      ),
    ).toBeLessThan(0);
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T08:00:00+08:00", arrayIndex: 3 },
        { occurredAt: "2026-07-25T00:00:00Z", arrayIndex: 2 },
        "array-index",
      ),
    ).toBeGreaterThan(0);
  });
});

describe("ledgerFactOrder record tiebreak", () => {
  it("orders same-day date-only facts by createdAt, then trades, then id", () => {
    expect(
      compareLedgerFactOrder(
        {
          occurredAt: "2026-07-25",
          createdAt: "2026-07-25T09:00:00Z",
          kind: "cash-event",
          id: "b",
        },
        {
          occurredAt: "2026-07-25",
          createdAt: "2026-07-25T10:00:00Z",
          kind: "trade",
          id: "a",
        },
      ),
    ).toBeLessThan(0);

    expect(
      compareLedgerFactOrder(
        {
          occurredAt: "2026-07-25",
          createdAt: "2026-07-25T09:00:00Z",
          kind: "cash-event",
          id: "a",
        },
        {
          occurredAt: "2026-07-25",
          createdAt: "2026-07-25T09:00:00Z",
          kind: "trade",
          id: "z",
        },
      ),
    ).toBeGreaterThan(0);

    expect(
      compareLedgerFactOrder(
        {
          occurredAt: "2026-07-25",
          createdAt: "2026-07-25T09:00:00Z",
          kind: "trade",
          id: "a",
        },
        {
          occurredAt: "2026-07-25",
          createdAt: "2026-07-25T09:00:00Z",
          kind: "trade",
          id: "b",
        },
      ),
    ).toBeLessThan(0);
  });

  it("never reads arrayIndex", () => {
    const left = {
      occurredAt: "2026-07-25",
      createdAt: "2026-07-25T09:00:00Z",
      kind: "trade",
      id: "a",
      arrayIndex: 9,
    } as const;
    const right = {
      occurredAt: "2026-07-25",
      createdAt: "2026-07-25T09:00:00Z",
      kind: "trade",
      id: "b",
      arrayIndex: 0,
    } as const;

    expect(compareLedgerFactOrder(left, right)).toBeLessThan(0);
  });
});
