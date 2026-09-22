"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ValuationPriceMode } from "@/core/models";
import { systemLedgerClock, type LedgerClock } from "@/core/shared";
import type { ChartRange } from "@/features/charts";
import {
  createPriceWorkspaceDraft,
  createTradeWorkspaceDraft,
  type PriceWorkspaceDraft,
  type RecordTarget,
  type TradeWorkspaceDraft,
} from "./workspaceDrafts";

export type LedgerWorkspacePage =
  | "home"
  | "record"
  | "transactions"
  | "transfer"
  | "settings";

export type LedgerWorkspaceIntent =
  | { page: "record"; focus: "trade" | "price" }
  | {
      page: "transactions";
      filterDate: string;
      expandTradeId?: string;
    }
  | { page: "transactions"; locateDate: string }
  | { page: "transactions"; expandTradeId: string }
  | { page: "transactions"; clearFilters: true }
  | { page: "home" | "transfer" | "settings" };

export function useLedgerWorkspaceSession({
  ledgerEpoch,
  defaultAssetSymbol = "",
  todayKey = "",
  clock = systemLedgerClock,
}: Readonly<{
  ledgerEpoch: number;
  defaultAssetSymbol?: string;
  todayKey?: string;
  clock?: LedgerClock;
}>) {
  const [currentPage, setCurrentPage] =
    useState<LedgerWorkspacePage>("home");
  const [intent, setIntent] = useState<LedgerWorkspaceIntent | null>(null);
  const [valuationPriceMode, setValuationPriceMode] =
    useState<ValuationPriceMode>("auto");
  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [recordTarget, setRecordTarget] = useState<RecordTarget>({
    kind: "cash",
    currency: "USDT",
  });
  const [homeDetailsOpen, setHomeDetailsOpen] = useState(false);
  const tradeDraftRef = useRef<TradeWorkspaceDraft>(
    createTradeWorkspaceDraft(defaultAssetSymbol, todayKey, clock),
  );
  const priceDraftRef = useRef<PriceWorkspaceDraft>(
    createPriceWorkspaceDraft(defaultAssetSymbol, todayKey, clock),
  );
  const recordResetDefaultsRef = useRef({ defaultAssetSymbol, todayKey, clock });
  recordResetDefaultsRef.current = { defaultAssetSymbol, todayKey, clock };

  const resetRecordSession = useCallback(() => {
    const defaults = recordResetDefaultsRef.current;
    setRecordTarget({ kind: "cash", currency: "USDT" });
    tradeDraftRef.current = createTradeWorkspaceDraft(
      defaults.defaultAssetSymbol,
      defaults.todayKey,
      defaults.clock,
    );
    priceDraftRef.current = createPriceWorkspaceDraft(
      defaults.defaultAssetSymbol,
      defaults.todayKey,
      defaults.clock,
    );
  }, []);

  const resetSessionUi = useCallback(() => {
    setCurrentPage("home");
    setIntent(null);
    setValuationPriceMode("auto");
    setChartRange("30d");
    setHomeDetailsOpen(false);
    resetRecordSession();
  }, [resetRecordSession]);

  useEffect(() => {
    setIntent(null);
    setHomeDetailsOpen(false);
    resetRecordSession();
  }, [ledgerEpoch, resetRecordSession]);

  const navigate = useCallback((nextIntent: LedgerWorkspaceIntent) => {
    setIntent(nextIntent);
    setCurrentPage(nextIntent.page);
    if (nextIntent.page !== "home") setHomeDetailsOpen(false);
  }, []);

  const navigateToPage = useCallback((page: LedgerWorkspacePage) => {
    setIntent(null);
    setCurrentPage(page);
    if (page !== "home") setHomeDetailsOpen(false);
  }, []);

  const consumeIntent = useCallback(() => setIntent(null), []);

  return {
    currentPage,
    intent,
    navigate,
    navigateToPage,
    consumeIntent,
    valuationPriceMode,
    setValuationPriceMode,
    chartRange,
    setChartRange,
    recordTarget,
    setRecordTarget,
    homeDetailsOpen,
    setHomeDetailsOpen,
    tradeDraftRef,
    priceDraftRef,
    resetSessionUi,
  } as const;
}
