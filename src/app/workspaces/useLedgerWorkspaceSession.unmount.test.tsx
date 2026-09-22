// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLedgerWorkspaceSession } from "./useLedgerWorkspaceSession";

describe("useLedgerWorkspaceSession unmounted workspace state", () => {
  it("keeps record state across navigation and clears it only for a new ledger epoch", () => {
    const { result, rerender } = renderHook(
      ({ defaultAssetSymbol, ledgerEpoch, todayKey }) =>
        useLedgerWorkspaceSession({
          defaultAssetSymbol,
          ledgerEpoch,
          todayKey,
        }),
      {
        initialProps: {
          defaultAssetSymbol: "BTC",
          ledgerEpoch: 1,
          todayKey: "2026-08-31",
        },
      },
    );

    act(() => {
      result.current.setRecordTarget({
        kind: "trade",
        assetSymbol: "BTC",
      });
      result.current.tradeDraftRef.current = {
        ...result.current.tradeDraftRef.current,
        quantity: "0.25",
      };
      result.current.priceDraftRef.current = {
        ...result.current.priceDraftRef.current,
        price: "75000",
      };
      result.current.navigateToPage("transactions");
    });

    expect(result.current.recordTarget).toEqual({
      kind: "trade",
      assetSymbol: "BTC",
    });
    expect(result.current.tradeDraftRef.current.quantity).toBe("0.25");
    expect(result.current.priceDraftRef.current.price).toBe("75000");

    rerender({
      defaultAssetSymbol: "ETH",
      ledgerEpoch: 2,
      todayKey: "2026-09-01",
    });

    expect(result.current.recordTarget).toEqual({
      kind: "cash",
      currency: "USDT",
    });
    expect(result.current.tradeDraftRef.current).toMatchObject({
      assetSymbol: "ETH",
      quantity: "",
      occurredAt: "2026-09-01",
    });
    expect(result.current.priceDraftRef.current).toMatchObject({
      assetSymbol: "ETH",
      price: "",
      recordedAt: "2026-09-01",
    });
  });

  it("closes lifted home details when navigation leaves the home page", () => {
    const { result } = renderHook(() =>
      useLedgerWorkspaceSession({ ledgerEpoch: 1 }),
    );

    act(() => result.current.setHomeDetailsOpen(true));
    expect(result.current.homeDetailsOpen).toBe(true);

    act(() => result.current.navigateToPage("settings"));
    expect(result.current.homeDetailsOpen).toBe(false);
  });
});
