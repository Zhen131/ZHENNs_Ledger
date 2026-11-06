/**
 * 这个文件管首页的持仓分配图。
 * 每一块多大在 `chartDataServiceAllocation.ts` 算好。
 * 不显然的决定：现金为负时只写缺口，不画负的一块；2026-08-19 定（W14 01B 第 6.4 节）。
 */
"use client";

import { useMemo } from "react";

import { USDT_USD_APPROXIMATION_DISCLOSURE } from "@/features/portfolio";
import { LedgerNumber, useLanguage } from "@/ui";
import type { HoldingAllocation } from "./chartDataService";
import { buildAllocationChartOption } from "./chartOptionBuilders";
import { EChart } from "./EChart";

/**
 * 这个组件画持仓分配圆环图。
 * 图下面写出有几块、计价单位。
 * 缺价格的币、不用 USDT 计价的币、现金缺口，各用一句话列出。
 * 没有可画的块时，显示空的说明。
 * 混着 USD 和 USDT 时，显示「1 USDT ≈ 1 USD」的说明。
 */
export function HoldingAllocationChart({
  allocation,
  compact = false,
}: Readonly<{
  allocation: HoldingAllocation;
  compact?: boolean;
}>) {
  const { t } = useLanguage();
  const option = useMemo(
    () =>
      buildAllocationChartOption(
        allocation.slices,
        allocation.valuation.label,
        t,
      ),
    [allocation.slices, allocation.valuation.label, t],
  );

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
      <h3 className="font-semibold text-[var(--ledger-ink)]">
        {t("charts.allocation.headingPrefix")}{allocation.valuation.label}{t("charts.allocation.headingSuffix")}
      </h3>
      {allocation.slices.length > 0 ? (
        <>
          <EChart
            ariaLabel={`${t("charts.allocation.ariaPrefix")}${allocation.valuation.label}${t("charts.allocation.ariaSuffix")}`}
            className={compact ? "h-36 w-full" : "h-80 w-full"}
            option={option}
          />
          <p className="text-sm leading-6 text-[var(--ledger-muted)]">
            {t("charts.allocation.geometryPrefix")}{allocation.slices.length}{t("charts.allocation.geometryMiddle")}{" "}
            <LedgerNumber kind="money" value={allocation.totalMarketValue} />{" "}
            {allocation.valuation.label}{t("charts.allocation.period")}
          </p>
        </>
      ) : allocation.missingPriceAssets.length > 0 ? (
        <p className="mt-3 text-sm leading-6 text-amber-800">
          {t("charts.allocation.missingDescription")}
          {allocation.missingPriceAssets.join(t("charts.allocation.joinSeparator"))}{t("charts.allocation.period")}
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("charts.allocation.emptyPrefix")}{" "}
          <LedgerNumber kind="money" value={allocation.totalMarketValue} />{" "}
          {allocation.valuation.label}{t("charts.allocation.period")}
        </p>
      )}
      {allocation.cashDeficit !== "0" ? (
        <p className="mt-2 text-sm font-semibold text-red-800">
          {t("charts.allocation.cashDeficit")} <LedgerNumber kind="money" value={allocation.cashDeficit} />{" "}
          USDT{t("charts.allocation.cashDeficitSuffix")}
        </p>
      ) : null}
      {allocation.slices.length > 0 &&
      allocation.missingPriceAssets.length > 0 ? (
        <p className="mt-2 text-sm font-medium text-amber-800">
          {t("charts.allocation.unvaluedPrefix")}{allocation.missingPriceAssets.join(t("charts.allocation.joinSeparator"))}{t("charts.allocation.period")}
        </p>
      ) : null}
      {allocation.excludedCurrencyAssets.length > 0 ? (
        <p className="mt-2 text-sm font-medium text-amber-800">
          {t("charts.allocation.excludedPrefix")}
          {allocation.excludedCurrencyAssets.join(t("charts.allocation.joinSeparator"))}{t("charts.allocation.period")}
        </p>
      ) : null}
      {allocation.valuation.usesApproximation ? (
        <p className="mt-2 text-sm font-medium text-amber-800">
          {USDT_USD_APPROXIMATION_DISCLOSURE}
        </p>
      ) : null}
    </article>
  );
}
