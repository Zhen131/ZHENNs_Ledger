/**
 * 这个文件把首页需要的数和开关，从外框接到首页组件上。
 * 首页长什么样在 `app/workspaces/HomeWorkspace.tsx`。
 * 没有特别的决定。
 */
"use client";

import {
  HomeWorkspace,
  type useLedgerWorkspaceSession,
} from "@/app/workspaces";
import type { PersistentLedgerState } from "@/app/persistence";
import type { DashboardDerivations } from "./dashboardDerivations";

/**
 * 这个组件画外框里的首页。
 * 它把算好的五样数、估值方式、走势范围交给首页组件。
 * 首页上的跳转按钮会切到记账页或交易页。
 */
export function DashboardShellHomePage({
  allocation,
  chartRange,
  heatmap,
  history,
  ledgerData,
  pnlSummary,
  positions,
  projection,
  setChartRange,
  setValuationPriceMode,
  valuationPriceMode,
  workspace,
}: Readonly<{
  allocation: DashboardDerivations["allocation"];
  chartRange: ReturnType<typeof useLedgerWorkspaceSession>["chartRange"];
  heatmap: DashboardDerivations["heatmap"];
  history: DashboardDerivations["history"];
  ledgerData: PersistentLedgerState["ledgerData"];
  pnlSummary: DashboardDerivations["pnlSummary"];
  positions: DashboardDerivations["projection"]["positions"];
  projection: DashboardDerivations["projection"];
  setChartRange: ReturnType<typeof useLedgerWorkspaceSession>["setChartRange"];
  setValuationPriceMode: ReturnType<typeof useLedgerWorkspaceSession>["setValuationPriceMode"];
  valuationPriceMode: ReturnType<typeof useLedgerWorkspaceSession>["valuationPriceMode"];
  workspace: ReturnType<typeof useLedgerWorkspaceSession>;
}>) {
  return (
        <HomeWorkspace
          active
          allocation={allocation}
          cashBalance={projection.cash.balance}
          detailsOpen={workspace.homeDetailsOpen}
          heatmap={heatmap}
          history={history}
          ledgerData={ledgerData}
          onNavigateToPrice={() =>
            workspace.navigate({ page: "record", focus: "price" })
          }
          onNavigateToTrade={() =>
            workspace.navigate({ page: "record", focus: "trade" })
          }
          onNavigateToTransactions={(intent) => {
            if ("clearFilters" in intent) {
              workspace.navigate({
                page: "transactions",
                clearFilters: true,
              });
            } else {
              workspace.navigate({
                page: "transactions",
                locateDate: intent.locateDate,
              });
            }
          }}
          onDetailsOpenChange={workspace.setHomeDetailsOpen}
          onRangeChange={setChartRange}
          onValuationPriceModeChange={setValuationPriceMode}
          pnlSummary={pnlSummary}
          positions={positions}
          range={chartRange}
          valuationPriceMode={valuationPriceMode}
        />
  );
}
