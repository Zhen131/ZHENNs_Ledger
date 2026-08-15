"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

export type TradeWorkspaceDraft = {
  type: "buy" | "sell";
  assetSymbol: string;
  quantity: string;
  price: string;
  totalValue: string;
  totalValueMode: "auto" | "manual";
  occurredAt: string;
  fee: string;
  platform: string;
  note: string;
  noteExpanded: boolean;
};

export type PriceWorkspaceDraft = {
  assetSymbol: string;
  price: string;
  recordedAt: string;
  note: string;
};

function createTradeDraft(
  assetSymbol: string,
  todayKey: string,
): TradeWorkspaceDraft {
  return {
    type: "buy",
    assetSymbol,
    quantity: "",
    price: "",
    totalValue: "",
    totalValueMode: "auto",
    occurredAt: todayKey,
    fee: "0",
    platform: "",
    note: "",
    noteExpanded: false,
  };
}

function createPriceDraft(
  assetSymbol: string,
  todayKey: string,
): PriceWorkspaceDraft {
  return {
    assetSymbol,
    price: "",
    recordedAt: todayKey,
    note: "",
  };
}

function tradeDraftHasUserInput(draft: TradeWorkspaceDraft): boolean {
  return (
    draft.type !== "buy" ||
    draft.quantity !== "" ||
    draft.price !== "" ||
    draft.totalValue !== "" ||
    draft.totalValueMode !== "auto" ||
    draft.fee !== "0" ||
    draft.platform !== "" ||
    draft.note !== "" ||
    draft.noteExpanded
  );
}

function priceDraftHasUserInput(draft: PriceWorkspaceDraft): boolean {
  return draft.price !== "" || draft.note !== "";
}

export function useLedgerWorkspaceSession({
  ledgerEpoch,
  defaultAssetSymbol,
  todayKey,
}: Readonly<{
  ledgerEpoch: number;
  defaultAssetSymbol: string;
  todayKey: string;
}>) {
  const [currentPage, setCurrentPage] =
    useState<LedgerWorkspacePage>("home");
  const [intent, setIntent] = useState<LedgerWorkspaceIntent | null>(null);
  const [tradeDraft, setTradeDraft] = useState<TradeWorkspaceDraft>(() =>
    createTradeDraft(defaultAssetSymbol, todayKey),
  );
  const [priceDraft, setPriceDraft] = useState<PriceWorkspaceDraft>(() =>
    createPriceDraft(defaultAssetSymbol, todayKey),
  );
  const [valuationPriceMode, setValuationPriceMode] =
    useState<ValuationPriceMode>("auto");
  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [autoRefreshAttempted, setAutoRefreshAttempted] = useState(false);

  const resetSessionUi = useCallback(() => {
    setCurrentPage("home");
    setIntent(null);
    setTradeDraft(createTradeDraft(defaultAssetSymbol, todayKey));
    setPriceDraft(createPriceDraft(defaultAssetSymbol, todayKey));
    setValuationPriceMode("auto");
    setChartRange("30d");
    setAutoRefreshAttempted(false);
  }, [defaultAssetSymbol, todayKey]);

  const resetLedgerContentUi = useCallback(() => {
    setIntent(null);
    setTradeDraft(createTradeDraft(defaultAssetSymbol, todayKey));
    setPriceDraft(createPriceDraft(defaultAssetSymbol, todayKey));
  }, [defaultAssetSymbol, todayKey]);

  useEffect(() => {
    resetLedgerContentUi();
  }, [ledgerEpoch, resetLedgerContentUi]);

  useEffect(() => {
    setTradeDraft((current) =>
      current.assetSymbol === ""
        ? { ...current, assetSymbol: defaultAssetSymbol }
        : current,
    );
    setPriceDraft((current) =>
      current.assetSymbol === ""
        ? { ...current, assetSymbol: defaultAssetSymbol }
        : current,
    );
  }, [defaultAssetSymbol]);

  const navigate = useCallback((nextIntent: LedgerWorkspaceIntent) => {
    setIntent(nextIntent);
    setCurrentPage(nextIntent.page);
  }, []);

  const navigateToPage = useCallback((page: LedgerWorkspacePage) => {
    setIntent(null);
    setCurrentPage(page);
  }, []);

  const consumeIntent = useCallback(() => setIntent(null), []);

  const resetTradeDraft = useCallback(
    (preserve?: Pick<TradeWorkspaceDraft, "assetSymbol" | "platform">) => {
      setTradeDraft({
        ...createTradeDraft(
          preserve?.assetSymbol ?? defaultAssetSymbol,
          todayKey,
        ),
        platform: preserve?.platform ?? "",
      });
    },
    [defaultAssetSymbol, todayKey],
  );

  const resetPriceDraft = useCallback(
    (preserve?: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">) => {
      setPriceDraft({
        ...createPriceDraft(
          preserve?.assetSymbol ?? defaultAssetSymbol,
          preserve?.recordedAt ?? todayKey,
        ),
      });
    },
    [defaultAssetSymbol, todayKey],
  );

  const hasDrafts = useMemo(
    () =>
      tradeDraftHasUserInput(tradeDraft) ||
      priceDraftHasUserInput(priceDraft),
    [priceDraft, tradeDraft],
  );

  return {
    currentPage,
    intent,
    navigate,
    navigateToPage,
    consumeIntent,
    tradeDraft,
    setTradeDraft,
    resetTradeDraft,
    priceDraft,
    setPriceDraft,
    resetPriceDraft,
    hasDrafts,
    valuationPriceMode,
    setValuationPriceMode,
    chartRange,
    setChartRange,
    autoRefreshAttempted,
    markAutoRefreshAttempted: () => setAutoRefreshAttempted(true),
    resetSessionUi,
  } as const;
}
