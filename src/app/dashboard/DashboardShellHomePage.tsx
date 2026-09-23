"use client";

import {
  HomeWorkspace,
  type useLedgerWorkspaceSession,
} from "@/app/workspaces";
import type { PersistentLedgerState } from "@/app/persistence";
import type { DashboardDerivations } from "./dashboardDerivations";

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
