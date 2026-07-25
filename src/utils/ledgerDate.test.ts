import { describe, expect, it } from "vitest";

import {
  compareLedgerFactOrder,
  createSystemLedgerClock,
  getLedgerDateKey,
} from "./ledgerDate";

describe("ledgerDate", () => {
  it("keeps the source YYYY-MM-DD key across offsets", () => {
    expect(getLedgerDateKey("2026-07-25")).toBe("2026-07-25");
    expect(getLedgerDateKey("2026-07-25T19:00:00+08:00")).toBe(
      "2026-07-25",
    );
    expect(getLedgerDateKey("2026-07-25T23:30:00-10:00")).toBe(
      "2026-07-25",
    );
  });

  it("sorts different days by source date key", () => {
    expect(
      compareLedgerFactOrder(
        "2026-07-25T23:30:00-10:00",
        "2026-07-26T00:01:00+14:00",
        0,
        1,
      ),
    ).toBeLessThan(0);
  });

  it("uses real instants only when both same-day facts have datetimes", () => {
    expect(
      compareLedgerFactOrder(
        "2026-07-25T12:00:00+08:00",
        "2026-07-25T05:00:00Z",
        0,
        1,
      ),
    ).toBeLessThan(0);
  });

  it("keeps array order for date-only mixtures and equal instants", () => {
    expect(
      compareLedgerFactOrder(
        "2026-07-25T23:00:00+08:00",
        "2026-07-25",
        0,
        1,
      ),
    ).toBeLessThan(0);
    expect(
      compareLedgerFactOrder(
        "2026-07-25T08:00:00+08:00",
        "2026-07-25T00:00:00Z",
        3,
        2,
      ),
    ).toBeGreaterThan(0);
  });

  it("derives today from an injectable local clock at year end", () => {
    const clock = createSystemLedgerClock(
      () => new Date(2026, 11, 31, 23, 59, 59),
    );
    expect(clock.todayKey()).toBe("2026-12-31");
  });
});
