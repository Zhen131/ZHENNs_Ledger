// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLedgerWorkspaceSession } from "./useLedgerWorkspaceSession";

describe("useLedgerWorkspaceSession", () => {
  it("keeps view choices while navigating the same ledger epoch", () => {
    const { result } = renderHook(() =>
      useLedgerWorkspaceSession({
        ledgerEpoch: 1,
      }),
    );

    act(() => {
      result.current.setChartRange("365d");
      result.current.setValuationPriceMode("manual");
      result.current.navigate({ page: "record", focus: "trade" });
    });

    expect(result.current.currentPage).toBe("record");
    expect(result.current.chartRange).toBe("365d");
    expect(result.current.valuationPriceMode).toBe("manual");
  });

  it("consumes one-time intents and resets all session UI on a ledger epoch change", () => {
    const { result, rerender } = renderHook(
      ({ ledgerEpoch }) =>
        useLedgerWorkspaceSession({
          ledgerEpoch,
        }),
      { initialProps: { ledgerEpoch: 1 } },
    );

    act(() => {
      result.current.navigate({
        page: "transactions",
        filterDate: "2026-08-10",
      });
    });
    expect(result.current.intent).toEqual({
      page: "transactions",
      filterDate: "2026-08-10",
    });

    act(() => result.current.consumeIntent());
    expect(result.current.intent).toBeNull();

    act(() => {
      result.current.navigate({
        page: "transactions",
        locateDate: "2026-08-11",
      });
    });

    rerender({ ledgerEpoch: 2 });
    expect(result.current.currentPage).toBe("transactions");
    expect(result.current.intent).toBeNull();
  });

  it("keeps one-time date location distinct from persistent date filtering", () => {
    const { result } = renderHook(() =>
      useLedgerWorkspaceSession({
        ledgerEpoch: 1,
      }),
    );

    act(() => {
      result.current.navigate({
        page: "transactions",
        locateDate: "2026-08-10",
      });
    });
    expect(result.current.intent).toEqual({
      page: "transactions",
      locateDate: "2026-08-10",
    });

    act(() => result.current.consumeIntent());
    expect(result.current.intent).toBeNull();
  });
});
