"use client";

import { USDT_USD_APPROXIMATION_DISCLOSURE } from "@/features/portfolio";
import { Section } from "./Section";
import { SummaryMetricCard } from "./SummaryMetricCard";
import type { useLanguage } from "@/ui";
import type { DashboardDerivations } from "./dashboardDerivations";

export function DashboardShellPnlSummarySection({
  pnlSummary,
  t,
}: Readonly<{
  pnlSummary: DashboardDerivations["pnlSummary"];
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
            <Section title={t("dashboard.section.pnlSummary")}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryMetricCard
                  label={t("dashboard.pnl.buyOutflow")}
                  metric={pnlSummary.buyOutflow}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.sellProceeds")}
                  metric={pnlSummary.sellProceeds}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.remainingCostBasis")}
                  metric={pnlSummary.remainingCostBasis}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.realized")}
                  metric={pnlSummary.realizedPnl}
                  valuationLabel={pnlSummary.valuation.label}
                />
                <SummaryMetricCard
                  label={t("dashboard.pnl.unrealized")}
                  metric={pnlSummary.unrealizedPnl}
                  valuationLabel={pnlSummary.valuation.label}
                />
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {t("dashboard.pnl.description")}
              </p>
              {pnlSummary.valuation.usesApproximation ? (
                <p className="mt-2 text-sm font-medium text-amber-800">
                  {USDT_USD_APPROXIMATION_DISCLOSURE}
                </p>
              ) : null}
            </Section>
  );
}
