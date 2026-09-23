"use client";

import type { LedgerActivityTypeFilter } from "@/features/activity";
import { SurfaceCard } from "@/ui";
import { FilterSelect } from "./FilterSelect";
import type { TimeFilter } from "./transactionsWorkspaceTypes";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

export function TransactionsWorkspaceFilterCard({
  assetFilter,
  assetOptions,
  exactDate,
  hasFilters,
  resetFilters,
  setAssetFilter,
  setCurrentPage,
  setExactDate,
  setTimeFilter,
  setTypeFilter,
  t,
  timeFilter,
  timeLabel,
  typeFilter,
  typeLabel,
}: Readonly<{
  assetFilter: string;
  assetOptions: string[];
  exactDate: string;
  hasFilters: boolean;
  resetFilters: () => void;
  setAssetFilter: Dispatch<SetStateAction<string>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  setExactDate: Dispatch<SetStateAction<string>>;
  setTimeFilter: Dispatch<SetStateAction<TimeFilter>>;
  setTypeFilter: Dispatch<SetStateAction<LedgerActivityTypeFilter>>;
  t: ReturnType<typeof useLanguage>["t"];
  timeFilter: TimeFilter;
  timeLabel: string;
  typeFilter: LedgerActivityTypeFilter;
  typeLabel: string;
}>) {
  return (
      <SurfaceCard className="sticky top-0 z-20 p-4">
        <div className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
          <FilterSelect
            label={t("transactions.filter.time")}
            onChange={(value) => {
              setTimeFilter(value as TimeFilter);
              setCurrentPage(1);
            }}
            options={[
              ["all", t("transactions.time.allTime")],
              ["today", t("transactions.time.today")],
              ["7d", t("transactions.time.7d")],
              ["1y", t("transactions.time.1y")],
            ]}
            value={timeFilter}
          />
          <label className="grid gap-1 text-xs font-medium text-[var(--ledger-muted)]">
            {t("transactions.filter.exactDate")}
            <input
              className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 text-sm text-[var(--ledger-ink)]"
              onChange={(event) => {
                setExactDate(event.target.value);
                setCurrentPage(1);
              }}
              type="date"
              value={exactDate}
            />
          </label>
          <FilterSelect
            label={t("transactions.filter.asset")}
            onChange={(value) => {
              setAssetFilter(value);
              setCurrentPage(1);
            }}
            options={[
              ["all", t("transactions.filter.allAssets")],
              ["USDT", t("transactions.filter.cashUsdt")],
              ...assetOptions.map((asset) => [asset, asset] as const),
            ]}
            value={assetFilter}
          />
          <FilterSelect
            label={t("transactions.filter.type")}
            onChange={(value) => {
              setTypeFilter(value as LedgerActivityTypeFilter);
              setCurrentPage(1);
            }}
            options={[
              ["all", t("transactions.filter.allTypes")],
              ["buy", t("trades.type.buy")],
              ["sell", t("trades.type.sell")],
              ["deposit", t("transactions.type.deposit")],
              ["withdrawal", t("transactions.type.withdrawal")],
              ["external-expense", t("transactions.type.externalExpense")],
              ["balance-adjustment", t("transactions.type.balanceAdjustment")],
            ]}
            value={typeFilter}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ledger-muted)]">
          <p>
            {t("transactions.activeFilters.time")}{timeLabel}{t("transactions.activeFilters.date")}{exactDate || t("transactions.time.all")}{t("transactions.activeFilters.asset")}
            {assetFilter === "all"
              ? t("transactions.time.all")
              : assetFilter === "USDT"
                ? t("transactions.filter.cashUsdt")
                : assetFilter}
            {t("transactions.activeFilters.type")}{typeLabel}
          </p>
          {hasFilters ? (
            <button
              className="font-semibold text-[var(--ledger-accent-strong)]"
              onClick={resetFilters}
              type="button"
            >
              {t("transactions.filter.clear")}
            </button>
          ) : null}
        </div>
      </SurfaceCard>
  );
}
