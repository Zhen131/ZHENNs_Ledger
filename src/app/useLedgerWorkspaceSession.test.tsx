// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLedgerWorkspaceSession } from "./useLedgerWorkspaceSession";

describe("useLedgerWorkspaceSession", () => {
  it("keeps drafts and view choices while navigating the same ledger epoch", () => {
    const { result } = renderHook(() =>
      useLedgerWorkspaceSession({
        ledgerEpoch: 1,
        defaultAssetSymbol: "BTC",
        todayKey: "2026-08-13",
      }),
    );

    act(() => {
      result.current.setTradeDraft((current) => ({
        ...current,
        quantity: "0.25",
      }));
      result.current.setPriceDraft((current) => ({
        ...current,
        price: "71000",
      }));
      result.current.setChartRange("365d");
      result.current.setValuationPriceMode("manual");
      result.current.navigate({ page: "record", focus: "trade" });
    });

    expect(result.current.currentPage).toBe("record");
    expect(result.current.tradeDraft.quantity).toBe("0.25");
    expect(result.current.priceDraft.price).toBe("71000");
    expect(result.current.hasDrafts).toBe(true);
    expect(result.current.chartRange).toBe("365d");
    expect(result.current.valuationPriceMode).toBe("manual");
  });

  it("consumes one-time intents and resets all session UI on a ledger epoch change", () => {
    const { result, rerender } = renderHook(
      ({ ledgerEpoch }) =>
        useLedgerWorkspaceSession({
          ledgerEpoch,
          defaultAssetSymbol: "BTC",
          todayKey: "2026-08-13",
        }),
      { initialProps: { ledgerEpoch: 1 } },
    );

    act(() => {
      result.current.navigate({
        page: "transactions",
        filterDate: "2026-08-10",
      });
      result.current.setTradeDraft((current) => ({
        ...current,
        note: "session only",
      }));
      result.current.markAutoRefreshAttempted();
    });
    expect(result.current.intent).toEqual({
      page: "transactions",
      filterDate: "2026-08-10",
    });

    act(() => result.current.consumeIntent());
    expect(result.current.intent).toBeNull();

    rerender({ ledgerEpoch: 2 });
    expect(result.current.currentPage).toBe("transactions");
    expect(result.current.tradeDraft.note).toBe("");
    expect(result.current.hasDrafts).toBe(false);
    expect(result.current.autoRefreshAttempted).toBe(true);
  });

  it("keeps one-time date location distinct from persistent date filtering", () => {
    const { result } = renderHook(() =>
      useLedgerWorkspaceSession({
        ledgerEpoch: 1,
        defaultAssetSymbol: "BTC",
        todayKey: "2026-08-13",
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
