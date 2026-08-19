"use client";

import { useMemo } from "react";

import { USDT_USD_APPROXIMATION_DISCLOSURE } from "@/features/portfolio";
import type { HoldingAllocation } from "./chartDataService";
import { buildAllocationChartOption } from "./chartOptionBuilders";
import { EChart } from "./EChart";

export function HoldingAllocationChart({
  allocation,
  compact = false,
}: Readonly<{
  allocation: HoldingAllocation;
  compact?: boolean;
}>) {
  const option = useMemo(
    () =>
      buildAllocationChartOption(
        allocation.slices,
        allocation.valuation.label,
      ),
    [allocation.slices, allocation.valuation.label],
  );

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--ledger-border)] bg-[var(--ledger-surface)] p-4">
      <h3 className="font-semibold text-[var(--ledger-ink)]">
        当前 {allocation.valuation.label} 资产分配
      </h3>
      {allocation.slices.length > 0 ? (
        <>
          <EChart
            ariaLabel={`当前 ${allocation.valuation.label} 资产分配饼图`}
            className={compact ? "h-36 w-full" : "h-80 w-full"}
            option={option}
          />
          <p className="text-sm leading-6 text-[var(--ledger-muted)]">
            几何分配 {allocation.slices.length} 项；净总资产{" "}
            {allocation.totalMarketValue} {allocation.valuation.label}。
          </p>
        </>
      ) : allocation.missingPriceAssets.length > 0 ? (
        <p className="mt-3 text-sm leading-6 text-amber-800">
          非零持仓缺少合法价格，当前不绘制误导性空饼。缺价资产：
          {allocation.missingPriceAssets.join("、")}。
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--ledger-muted)]">
          当前没有可绘制的正资产扇区；净总资产为{" "}
          {allocation.totalMarketValue} {allocation.valuation.label}。
        </p>
      )}
      {allocation.cashDeficit !== "0" ? (
        <p className="mt-2 text-sm font-semibold text-red-800">
          现金缺口 {allocation.cashDeficit} USDT；负现金不绘制为正扇区。
        </p>
      ) : null}
      {allocation.slices.length > 0 &&
      allocation.missingPriceAssets.length > 0 ? (
        <p className="mt-2 text-sm font-medium text-amber-800">
          未估值资产：{allocation.missingPriceAssets.join("、")}。
        </p>
      ) : null}
      {allocation.excludedCurrencyAssets.length > 0 ? (
        <p className="mt-2 text-sm font-medium text-amber-800">
          非 USD/USDT 旧资产已排除：
          {allocation.excludedCurrencyAssets.join("、")}。
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
