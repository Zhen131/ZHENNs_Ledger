"use client";

import type { ValuationPriceMode } from "@/core/models";
import type { GlobalRefreshState } from "./marketDataControlsTypes";
import type { useLanguage } from "@/ui";



export function MarketDataControlsRefreshBar({
  anyAssetOperation,
  globalBusy,
  hasRefreshableHolding,
  isWritable,
  mode,
  onModeChange,
  refreshNonZeroHoldings,
  refreshState,
  t,
}: Readonly<{
  anyAssetOperation: boolean;
  globalBusy: boolean;
  hasRefreshableHolding: boolean;
  isWritable: boolean;
  mode: ValuationPriceMode;
  onModeChange: (mode: ValuationPriceMode) => void;
  refreshNonZeroHoldings: () => Promise<void>;
  refreshState: GlobalRefreshState;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t("marketData.priceMode.label")}</span>
            {(["auto", "manual"] as const).map((value) => (
              <button
                aria-pressed={mode === value}
                className={
                  mode === value
                    ? "rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white"
                    : "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                }
                key={value}
                onClick={() => onModeChange(value)}
                type="button"
              >
                {value === "auto" ? t("marketData.priceMode.auto") : t("marketData.priceMode.manual")}
              </button>
            ))}
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !isWritable ||
                !hasRefreshableHolding ||
                globalBusy ||
                anyAssetOperation
              }
              onClick={() => void refreshNonZeroHoldings()}
              type="button"
            >
              {globalBusy
                ? t("marketData.refresh.updating")
                : t("marketData.refresh.action")}
            </button>
          </div>
          <p
            aria-live="polite"
            className={
              refreshState.status === "error"
                ? "text-sm text-red-800"
                : "text-sm text-slate-700"
            }
          >
            {refreshState.message}
          </p>
        </>
  );
}
