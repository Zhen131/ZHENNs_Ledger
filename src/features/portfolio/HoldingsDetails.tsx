"use client";

import { useEffect, useRef } from "react";

import type { Position } from "@/core/models";
import { LedgerIcon } from "@/ui";

export function HoldingsDetails({
  open,
  positions,
  cashBalance,
  onClose,
}: Readonly<{
  open: boolean;
  positions: readonly Position[];
  cashBalance: string;
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
        className="h-full w-full max-w-3xl overflow-y-auto bg-[var(--ledger-shell)] p-5 shadow-2xl motion-safe:animate-[ledger-slide-in_180ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--ledger-muted)]">
              实时派生，不单独存储
            </p>
            <h2 className="mt-1 text-xl font-semibold">完整持仓详情</h2>
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
            className="hidden grid-cols-8 gap-3 border-b border-[var(--ledger-border)] py-2 text-sm text-[var(--ledger-muted)] lg:grid"
            role="row"
          >
            {[
              "资产",
              "持仓数量",
              "含费平均成本",
              "剩余含费成本",
              "已实现净盈亏",
              "当前价格",
              "当前市值",
              "未实现净盈亏",
            ].map((label) => (
              <span key={label} role="columnheader">{label}</span>
            ))}
          </div>
          <div className="divide-y divide-[var(--ledger-border)]" role="rowgroup">
            <HoldingDetailRow
              values={[
                "现金 USDT",
                `${cashBalance} USDT`,
                "—",
                "—",
                "—",
                "1 USDT",
                `${cashBalance} USDT`,
                "—",
              ]}
            />
            {positions.map((position) => (
              <HoldingDetailRow
                key={`${position.assetSymbol}-${position.currency}`}
                values={[
                  position.assetSymbol,
                  position.quantity,
                  metric(position.averageCost, position.currency, position.feeAccountingIssues !== undefined),
                  metric(position.costBasis, position.currency, position.feeAccountingIssues !== undefined),
                  metric(position.realizedPnl, position.currency, position.feeAccountingIssues !== undefined),
                  position.latestPrice === undefined ? "未输入价格" : `${position.latestPrice} ${position.currency}`,
                  position.marketValue === undefined ? "—" : `${position.marketValue} ${position.currency}`,
                  position.feeAccountingIssues ? "不可可靠计算" : position.unrealizedPnl === undefined ? "缺少合法价格" : `${position.unrealizedPnl} ${position.currency}`,
                ]}
              />
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

const holdingLabels = [
  "资产",
  "持仓数量",
  "含费平均成本",
  "剩余含费成本",
  "已实现净盈亏",
  "当前价格",
  "当前市值",
  "未实现净盈亏",
] as const;

function HoldingDetailRow({ values }: Readonly<{ values: readonly string[] }>) {
  return (
    <div
      className="grid min-w-0 gap-2 py-4 text-sm lg:grid-cols-8 lg:gap-3"
      role="row"
    >
      {values.map((value, index) => (
        <div
          className="grid min-w-0 grid-cols-[minmax(7rem,.7fr)_minmax(0,1fr)] gap-2 lg:block"
          key={holdingLabels[index]}
          role="cell"
        >
          <span className="text-[var(--ledger-muted)] lg:hidden">
            {holdingLabels[index]}
          </span>
          <span className={`min-w-0 break-words ${index === 0 ? "font-semibold" : "ledger-numeric"}`}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function metric(value: string, currency: string, unreliable: boolean) {
  return unreliable ? "不可可靠计算" : `${value} ${currency}`;
}
