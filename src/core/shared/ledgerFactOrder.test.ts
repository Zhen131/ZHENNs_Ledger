import { describe, expect, it } from "vitest";

import {
  compareLedgerFactOrder,
  getLedgerFactSortInstant,
} from "./ledgerFactOrder";

const at = (value: string) => Date.parse(value);

describe("ledgerFactOrder sorting instant", () => {
  it("uses a timed fact's own instant", () => {
    // 2026-07-25 23:30 at UTC-10 is 2026-07-26 09:30 in Greenwich.
    expect(
      getLedgerFactSortInstant({ occurredAt: "2026-07-25T23:30:00-10:00" }),
    ).toBe(at("2026-07-26T09:30:00Z"));
  });

  it("places a date-only fact without a place at UTC midnight", () => {
    expect(getLedgerFactSortInstant({ occurredAt: "2026-08-21" })).toBe(
      at("2026-08-21T00:00:00Z"),
    );
  });

  it("places a date-only fact with a place at midnight in that place", () => {
    // Budapest is UTC+2 in August, so its 2026-08-21 begins two hours earlier
    // than UTC's.
    expect(
      getLedgerFactSortInstant({
        occurredAt: "2026-08-21",
        occurredTimeZone: "Europe/Budapest",
      }),
    ).toBe(at("2026-08-20T22:00:00Z"));

    // Shanghai is UTC+8 all year.
    expect(
      getLedgerFactSortInstant({
        occurredAt: "2026-08-21",
        occurredTimeZone: "Asia/Shanghai",
      }),
    ).toBe(at("2026-08-20T16:00:00Z"));
  });

  it("starts the day at the first wall time that exists when midnight is skipped", () => {
    // Santiago moves 00:00 to 01:00 on 2026-09-06, so that day has no local
    // midnight and begins at 01:00-03:00.
    expect(
      getLedgerFactSortInstant({
        occurredAt: "2026-09-06",
        occurredTimeZone: "America/Santiago",
      }),
    ).toBe(at("2026-09-06T04:00:00Z"));

    // Beirut skips its 2026-03-29 midnight the same way.
    expect(
      getLedgerFactSortInstant({
        occurredAt: "2026-03-29",
        occurredTimeZone: "Asia/Beirut",
      }),
    ).toBe(at("2026-03-28T22:00:00Z"));
  });

  it("falls back to UTC midnight rather than throwing on an unusable place", () => {
    expect(
      getLedgerFactSortInstant({
        occurredAt: "2026-08-21",
        occurredTimeZone: "Not/AZone",
      }),
    ).toBe(at("2026-08-21T00:00:00Z"));
  });

  it("reads nothing but the fact itself", () => {
    const fact = {
      occurredAt: "2026-08-21",
      occurredTimeZone: "Europe/Budapest",
    } as const;

    expect(getLedgerFactSortInstant(fact)).toBe(getLedgerFactSortInstant(fact));
    expect(getLedgerFactSortInstant(fact)).toBe(at("2026-08-20T22:00:00Z"));
  });
});

describe("ledgerFactOrder rule", () => {
  it("orders by what really happened first, not by the local date", () => {
    // The inputs of the pre-batch "sorts different days by source date key"
    // case. Their local dates read 07-25 then 07-26, but 07-26T00:01+14:00 is
    // 07-25T10:01Z and 07-25T23:30-10:00 is 07-26T09:30Z, so the fact with the
    // later local date really happened first. The order is now the real one.
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T23:30:00-10:00" },
        { occurredAt: "2026-07-26T00:01:00+14:00" },
      ),
    ).toBeGreaterThan(0);
  });

  it("orders two same-day timed facts by their instants", () => {
    // 12:00+08:00 is 04:00Z, which precedes 05:00Z.
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T12:00:00+08:00" },
        { occurredAt: "2026-07-25T05:00:00Z" },
      ),
    ).toBeLessThan(0);
  });

  it("puts a date-only fact before the timed facts of its own day", () => {
    // 23:00+08:00 is 15:00Z; the date-only fact sits at 00:00Z.
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T23:00:00+08:00" },
        { occurredAt: "2026-07-25" },
      ),
    ).toBeGreaterThan(0);

    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25" },
        { occurredAt: "2026-07-25T00:00:01Z" },
      ),
    ).toBeLessThan(0);
  });

  it("ties two facts that share an instant and carry nothing else to compare", () => {
    // 08:00+08:00 and 00:00Z are the same instant. The pre-batch rule broke
    // this tie on the caller's array positions; that rule is gone, so with no
    // createdAt, kind or id the two facts are equal.
    expect(
      compareLedgerFactOrder(
        { occurredAt: "2026-07-25T08:00:00+08:00" },
        { occurredAt: "2026-07-25T00:00:00Z" },
      ),
    ).toBe(0);
  });

  it("breaks an instant tie by createdAt, then trades first, then id", () => {
    const base = { occurredAt: "2026-07-25T00:00:00Z" } as const;

    expect(
      compareLedgerFactOrder(
        { ...base, createdAt: "2026-07-25T09:00:00Z", kind: "cash-event", id: "b" },
        { ...base, createdAt: "2026-07-25T10:00:00Z", kind: "trade", id: "a" },
      ),
    ).toBeLessThan(0);

    expect(
      compareLedgerFactOrder(
        { ...base, createdAt: "2026-07-25T09:00:00Z", kind: "cash-event", id: "a" },
        { ...base, createdAt: "2026-07-25T09:00:00Z", kind: "trade", id: "z" },
      ),
    ).toBeGreaterThan(0);

    expect(
      compareLedgerFactOrder(
        { ...base, createdAt: "2026-07-25T09:00:00Z", kind: "trade", id: "a" },
        { ...base, createdAt: "2026-07-25T09:00:00Z", kind: "trade", id: "b" },
      ),
    ).toBeLessThan(0);
  });

  it("gives the same order whatever order the facts arrive in", () => {
    const facts = [
      { occurredAt: "2026-07-25T23:30:00-10:00", createdAt: "2026-07-27T00:00:00Z", kind: "trade", id: "d" },
      { occurredAt: "2026-07-26T00:01:00+14:00", createdAt: "2026-07-27T00:00:01Z", kind: "trade", id: "c" },
      { occurredAt: "2026-07-25", createdAt: "2026-07-27T00:00:02Z", kind: "cash-event", id: "b" },
      { occurredAt: "2026-07-25", occurredTimeZone: "Asia/Shanghai", createdAt: "2026-07-27T00:00:03Z", kind: "trade", id: "a" },
    ] as const;

    const ascending = [...facts].sort(compareLedgerFactOrder).map((f) => f.id);
    const fromReversed = [...facts]
      .reverse()
      .sort(compareLedgerFactOrder)
      .map((f) => f.id);
    const fromRotated = [facts[2], facts[0], facts[3], facts[1]]
      .sort(compareLedgerFactOrder)
      .map((f) => f.id);

    // Hand-computed instants: a = 2026-07-24T16:00Z, b = 2026-07-25T00:00Z,
    // c = 2026-07-25T10:01Z, d = 2026-07-26T09:30Z.
    expect(ascending).toEqual(["a", "b", "c", "d"]);
    expect(fromReversed).toEqual(["a", "b", "c", "d"]);
    expect(fromRotated).toEqual(["a", "b", "c", "d"]);
  });
});
