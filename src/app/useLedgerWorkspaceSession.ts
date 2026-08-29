"use client";

import { useCallback, useEffect, useState } from "react";

import type { ValuationPriceMode } from "@/core/models";
import type { ChartRange } from "@/features/charts";

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
}: Readonly<{
  ledgerEpoch: number;
}>) {
  const [currentPage, setCurrentPage] =
    useState<LedgerWorkspacePage>("home");
  const [intent, setIntent] = useState<LedgerWorkspaceIntent | null>(null);
  const [valuationPriceMode, setValuationPriceMode] =
    useState<ValuationPriceMode>("auto");
  const [chartRange, setChartRange] = useState<ChartRange>("30d");

  const resetSessionUi = useCallback(() => {
    setCurrentPage("home");
    setIntent(null);
    setValuationPriceMode("auto");
    setChartRange("30d");
  }, []);

  useEffect(() => {
    setIntent(null);
  }, [ledgerEpoch]);

  const navigate = useCallback((nextIntent: LedgerWorkspaceIntent) => {
    setIntent(nextIntent);
    setCurrentPage(nextIntent.page);
  }, []);

  const navigateToPage = useCallback((page: LedgerWorkspacePage) => {
    setIntent(null);
    setCurrentPage(page);
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
    resetSessionUi,
  } as const;
}
