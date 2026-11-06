/**
 * 这个文件管几个工作区页面之间共用的界面状态。
 * 比如当前在哪页，跳页带的请求，估值方式，图表范围，记账草稿。
 * 账本内容本身不在这里，在 `app/persistence`。
 * 不显然的决定：只有换了一本账本，记账草稿才清空。
 * 2026-08-29 提交 96ec640 起这样做。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ValuationPriceMode } from "@/core/models";
import { systemLedgerClock, type LedgerClock } from "@/core/shared";
import type { ChartRange } from "@/features/charts";
import {
  createPriceWorkspaceDraft,
  type PriceWorkspaceDraft,
} from "@/features/prices";
import {
  createTradeWorkspaceDraft,
  type TradeWorkspaceDraft,
} from "@/features/trades";
import type { RecordTarget } from "./workspaceDrafts";

/** 五个工作区页面：首页、记账、交易、导入与导出、设置。 */
export type LedgerWorkspacePage =
  | "home"
  | "record"
  | "transactions"
  | "transfer"
  | "settings";

/**
 * 跳到某一页时顺便带的请求。
 * 比如去记账页并聚焦价格表单，去交易页并按某天筛选。
 */
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

/**
 * 这个 hook 管工作区页面之间共用的界面状态。
 * 它返回当前页，跳页函数，估值方式，图表范围，记账草稿等。
 * 换了一本账本（`ledgerEpoch` 变了），记账页的草稿回到空白。
 * 关掉账本时可调 `resetSessionUi` 把这些全部恢复默认。
 * 不会出错。
 */
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
