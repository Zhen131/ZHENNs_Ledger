"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { DecimalString, Position } from "@/core/models";
import { LedgerIcon, LedgerNumber } from "@/ui";

import type { SummaryMetric } from "./pnlSummaryService";

export function HoldingsDetails({
  open,
  positions,
  cashBalance,
  buyOutflowByAsset,
  onClose,
}: Readonly<{
  open: boolean;
  positions: readonly Position[];
  cashBalance: DecimalString;
  buyOutflowByAsset: Readonly<Record<string, SummaryMetric>>;
  onClose: () => void;
}>) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-stone-950/20"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      <aside
        aria-label="完整持仓详情"
        className="h-full w-full max-w-6xl overflow-y-auto bg-[var(--ledger-shell)] p-5 shadow-2xl motion-safe:animate-[ledger-slide-in_180ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--ledger-muted)]">
              实时派生，不单独存储
            </p>
            <h2 className="mt-1 text-xl font-semibold">完整持仓详情</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
              累计买入流出是历史上买入一共支出的现金，不与本表其他任何列相减。
            </p>
          </div>
          <button
            aria-label="关闭完整持仓详情"
            className="rounded-lg border border-[var(--ledger-border)] p-2 text-[var(--ledger-muted)]"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <LedgerIcon className="h-5 w-5" name="close" />
          </button>
        </header>
        <div className="mt-5" role="table" aria-label="完整持仓与现金明细">
          <div
            className="hidden grid-cols-12 gap-3 border-b border-[var(--ledger-border)] py-2 text-sm text-[var(--ledger-muted)] lg:grid"
            role="row"
          >
            {[
              "资产",
              "持仓数量",
              "交易所数量",
              "冷钱包数量",
              "冷钱包理财数量",
              "持仓均价",
              "剩余持仓成本",
              "已实现盈亏",
              "当前价格",
              "当前市值",
              "未实现盈亏",
              "累计买入流出",
            ].map((label, index, labels) => (
              <span
                className={
                  index === labels.length - 1
                    ? "border-l border-[var(--ledger-border)] pl-3"
                    : undefined
                }
                key={label}
                role="columnheader"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="divide-y divide-[var(--ledger-border)]" role="rowgroup">
            <HoldingDetailRow
              values={[
                "现金 USDT",
                <><LedgerNumber kind="money" value={cashBalance} /> USDT</>,
                "—",
                "—",
                "—",
                "—",
                "—",
                "—",
                <><LedgerNumber kind="money" value="1" /> USDT</>,
                <><LedgerNumber kind="money" value={cashBalance} /> USDT</>,
                "—",
                "—",
              ]}
            />
            {positions.map((position) => {
              const buyOutflow = buyOutflowByAsset[position.assetSymbol] ?? {
                value: "0",
                missingReasons: [],
              };
              return (
                <HoldingDetailRow
                  key={`${position.assetSymbol}-${position.currency}`}
                  values={[
                    position.assetSymbol,
                    <LedgerNumber key="quantity" kind="quantity" value={position.quantity} />,
                    <LedgerNumber key="exchange" kind="quantity" value={position.locationQuantities.exchange} />,
                    <LedgerNumber key="cold-wallet" kind="quantity" value={position.locationQuantities["cold-wallet"]} />,
                    <LedgerNumber key="cold-wallet-earn" kind="quantity" value={position.locationQuantities["cold-wallet-earn"]} />,
                    metric(position.averageCost, position.currency, position.feeAccountingIssues !== undefined),
                    metric(position.costBasis, position.currency, position.feeAccountingIssues !== undefined),
                    metric(position.realizedPnl, position.currency, position.feeAccountingIssues !== undefined),
                    position.latestPrice === undefined ? "未输入价格" : <><LedgerNumber kind="money" value={position.latestPrice} /> {position.currency}</>,
                    position.marketValue === undefined ? "—" : <><LedgerNumber kind="money" value={position.marketValue} /> {position.currency}</>,
                    position.feeAccountingIssues ? "不可可靠计算" : position.unrealizedPnl === undefined ? "缺少合法价格" : <><LedgerNumber kind="money" value={position.unrealizedPnl} /> {position.currency}</>,
                    summaryMetric(buyOutflow, position.currency),
                  ]}
                />
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

const holdingLabels = [
  "资产",
  "持仓数量",
  "交易所数量",
  "冷钱包数量",
  "冷钱包理财数量",
  "持仓均价",
  "剩余持仓成本",
  "已实现盈亏",
  "当前价格",
  "当前市值",
  "未实现盈亏",
  "累计买入流出",
] as const;

function HoldingDetailRow({ values }: Readonly<{ values: readonly ReactNode[] }>) {
  return (
    <div
      className="grid min-w-0 gap-2 py-4 text-sm lg:grid-cols-12 lg:gap-3"
      role="row"
    >
      {values.map((value, index) => (
        <div
          className={`grid min-w-0 grid-cols-[minmax(7rem,.7fr)_minmax(0,1fr)] gap-2 lg:block ${
            index === holdingLabels.length - 1
              ? "border-t border-[var(--ledger-border)] pt-2 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0"
              : ""
          }`}
          key={holdingLabels[index]}
          role="cell"
        >
          <span className="text-[var(--ledger-muted)] lg:hidden">
            {holdingLabels[index]}
          </span>
          <span className={`min-w-0 break-words ${index === 0 ? "font-semibold" : ""}`}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function metric(
  value: DecimalString,
  currency: string,
  unreliable: boolean,
): ReactNode {
  return unreliable ? "不可可靠计算" : (
    <><LedgerNumber kind="money" value={value} /> {currency}</>
  );
}

function summaryMetric(metricValue: SummaryMetric, currency: string): ReactNode {
  return metricValue.value === undefined ? (
    <span title={metricValue.missingReasons.join("；")}>不可完整计算</span>
  ) : (
    <><LedgerNumber kind="money" value={metricValue.value} /> {currency}</>
  );
}
