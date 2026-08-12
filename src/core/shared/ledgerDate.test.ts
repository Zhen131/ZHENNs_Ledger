import { describe, expect, it, vi } from "vitest";

import {
  captureLedgerTime,
  compareLedgerFactOrder,
  createSystemLedgerClock,
  getLedgerDateKey,
  millisecondsUntilNextLocalMidnight,
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

  it("captures now and local today from one clock read at year end", () => {
    const now = vi.fn(() => new Date(2026, 11, 31, 23, 59, 59));
    const clock = createSystemLedgerClock(
      now,
    );
    const snapshot = captureLedgerTime(clock);

    expect(snapshot.todayKey).toBe("2026-12-31");
    expect(snapshot.now).toBe(now.mock.results[0]?.value);
    expect(now).toHaveBeenCalledOnce();
  });

  it("does not mix two dates when an injected clock would cross midnight", () => {
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date(2026, 6, 25, 23, 59, 59, 999))
      .mockReturnValueOnce(new Date(2026, 6, 26, 0, 0, 0, 1));

    const snapshot = captureLedgerTime(createSystemLedgerClock(now));

    expect(snapshot.todayKey).toBe("2026-07-25");
    expect(snapshot.now.getDate()).toBe(25);
    expect(now).toHaveBeenCalledOnce();
  });

  it("calculates the remaining delay to the next local midnight", () => {
    expect(
      millisecondsUntilNextLocalMidnight(
        new Date(2026, 6, 25, 23, 59, 59, 500),
      ),
    ).toBe(500);
  });
});
