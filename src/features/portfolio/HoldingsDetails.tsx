"use client";

import { useEffect, useRef } from "react";

import type { Position } from "@/core/models";
import { LedgerIcon } from "@/ui";

export function HoldingsDetails({
  open,
  positions,
  onClose,
}: Readonly<{
  open: boolean;
  positions: readonly Position[];
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
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-[var(--ledger-border)] text-[var(--ledger-muted)]">
              <tr>
                <th className="py-2">资产</th>
                <th className="py-2">持仓数量</th>
                <th className="py-2">含费平均成本</th>
                <th className="py-2">剩余含费成本</th>
                <th className="py-2">已实现净盈亏</th>
                <th className="py-2">当前价格</th>
                <th className="py-2">当前市值</th>
                <th className="py-2">未实现净盈亏</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ledger-border)]">
              {positions.length === 0 ? (
                <tr>
                  <td className="py-8 text-center text-[var(--ledger-muted)]" colSpan={8}>
                    暂无持仓。添加交易后，这里会自动汇总。
                  </td>
                </tr>
              ) : (
                positions.map((position) => (
                  <tr key={`${position.assetSymbol}-${position.currency}`}>
                    <td className="py-3 font-semibold">{position.assetSymbol}</td>
                    <td className="ledger-numeric py-3">{position.quantity}</td>
                    <td className="ledger-numeric py-3">{metric(position.averageCost, position.currency, position.feeAccountingIssues !== undefined)}</td>
                    <td className="ledger-numeric py-3">{metric(position.costBasis, position.currency, position.feeAccountingIssues !== undefined)}</td>
                    <td className="ledger-numeric py-3">{metric(position.realizedPnl, position.currency, position.feeAccountingIssues !== undefined)}</td>
                    <td className="ledger-numeric py-3">{position.latestPrice === undefined ? "未输入价格" : `${position.latestPrice} ${position.currency}`}</td>
                    <td className="ledger-numeric py-3">{position.marketValue === undefined ? "--" : `${position.marketValue} ${position.currency}`}</td>
                    <td className="ledger-numeric py-3">{position.feeAccountingIssues ? "不可可靠计算" : position.unrealizedPnl === undefined ? "缺少合法价格" : `${position.unrealizedPnl} ${position.currency}`}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}

function metric(value: string, currency: string, unreliable: boolean) {
  return unreliable ? "不可可靠计算" : `${value} ${currency}`;
}
