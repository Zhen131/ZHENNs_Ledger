"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { DecimalString, Position } from "@/core/models";
import { LedgerIcon, LedgerNumber, useLanguage } from "@/ui";

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
  const { t } = useLanguage();
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

  const holdingLabels = [
    t("portfolio.details.column.asset"),
    t("portfolio.details.column.quantity"),
    t("portfolio.details.column.exchangeQuantity"),
    t("portfolio.details.column.coldWalletQuantity"),
    t("portfolio.details.column.coldWalletEarnQuantity"),
    t("portfolio.details.column.averageCost"),
    t("portfolio.details.column.costBasis"),
    t("portfolio.details.column.realizedPnl"),
    t("portfolio.details.column.latestPrice"),
    t("portfolio.details.column.marketValue"),
    t("portfolio.details.column.unrealizedPnl"),
    t("portfolio.details.column.buyOutflow"),
  ];
  const metric = (
    value: DecimalString,
    currency: string,
    unreliable: boolean,
  ): ReactNode =>
    unreliable ? t("portfolio.details.unreliable") : (
      <><LedgerNumber kind="money" value={value} /> {currency}</>
    );
  const summaryMetric = (
    metricValue: SummaryMetric,
    currency: string,
  ): ReactNode =>
    metricValue.value === undefined ? (
      <span title={metricValue.missingReasons.join(t("portfolio.details.joinSeparator"))}>{t("portfolio.details.incomplete")}</span>
    ) : (
      <><LedgerNumber kind="money" value={metricValue.value} /> {currency}</>
    );

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
        aria-label={t("portfolio.details.ariaLabel")}
        className="h-full w-full max-w-6xl overflow-y-auto bg-[var(--ledger-shell)] p-5 shadow-2xl motion-safe:animate-[ledger-slide-in_180ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--ledger-muted)]">
              {t("portfolio.details.derived")}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{t("portfolio.details.ariaLabel")}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ledger-muted)]">
              {t("portfolio.details.description")}
            </p>
          </div>
          <button
            aria-label={t("portfolio.details.closeAriaLabel")}
            className="rounded-lg border border-[var(--ledger-border)] p-2 text-[var(--ledger-muted)]"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <LedgerIcon className="h-5 w-5" name="close" />
          </button>
        </header>
        <div className="mt-5" role="table" aria-label={t("portfolio.details.tableAriaLabel")}>
          <div
            className="hidden grid-cols-12 gap-3 border-b border-[var(--ledger-border)] py-2 text-sm text-[var(--ledger-muted)] lg:grid"
            role="row"
          >
            {[
              ...holdingLabels,
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
              labels={holdingLabels}
              values={[
                t("portfolio.details.cash"),
                <><LedgerNumber kind="money" value={cashBalance} /> USDT</>,
                t("portfolio.details.dash"),
                t("portfolio.details.dash"),
                t("portfolio.details.dash"),
                t("portfolio.details.dash"),
                t("portfolio.details.dash"),
                t("portfolio.details.dash"),
                <><LedgerNumber kind="money" value="1" /> USDT</>,
                <><LedgerNumber kind="money" value={cashBalance} /> USDT</>,
                t("portfolio.details.dash"),
                t("portfolio.details.dash"),
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
                  labels={holdingLabels}
                  values={[
                    position.assetSymbol,
                    <LedgerNumber key="quantity" kind="quantity" value={position.quantity} />,
                    <LedgerNumber key="exchange" kind="quantity" value={position.locationQuantities.exchange} />,
                    <LedgerNumber key="cold-wallet" kind="quantity" value={position.locationQuantities["cold-wallet"]} />,
                    <LedgerNumber key="cold-wallet-earn" kind="quantity" value={position.locationQuantities["cold-wallet-earn"]} />,
                    metric(position.averageCost, position.currency, position.feeAccountingIssues !== undefined),
                    metric(position.costBasis, position.currency, position.feeAccountingIssues !== undefined),
                    metric(position.realizedPnl, position.currency, position.feeAccountingIssues !== undefined),
                    position.latestPrice === undefined ? t("portfolio.details.noPrice") : <><LedgerNumber kind="money" value={position.latestPrice} /> {position.currency}</>,
                    position.marketValue === undefined ? t("portfolio.details.dash") : <><LedgerNumber kind="money" value={position.marketValue} /> {position.currency}</>,
                    position.feeAccountingIssues ? t("portfolio.details.unreliable") : position.unrealizedPnl === undefined ? t("portfolio.details.missingPrice") : <><LedgerNumber kind="money" value={position.unrealizedPnl} /> {position.currency}</>,
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

function HoldingDetailRow({ labels, values }: Readonly<{ labels: readonly string[]; values: readonly ReactNode[] }>) {
  return (
    <div
      className="grid min-w-0 gap-2 py-4 text-sm lg:grid-cols-12 lg:gap-3"
      role="row"
    >
      {values.map((value, index) => (
        <div
          className={`grid min-w-0 grid-cols-[minmax(7rem,.7fr)_minmax(0,1fr)] gap-2 lg:block ${
            index === labels.length - 1
              ? "border-t border-[var(--ledger-border)] pt-2 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0"
              : ""
          }`}
          key={labels[index]}
          role="cell"
        >
          <span className="text-[var(--ledger-muted)] lg:hidden">
            {labels[index]}
          </span>
          <span className={`min-w-0 break-words ${index === 0 ? "font-semibold" : ""}`}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
