"use client";

import { selectPriceAsOf } from "@/features/portfolio";
import { LedgerNumber } from "@/ui";
import { formatBinanceFailure } from "./marketDataControlsHelpers";
import type {
  LedgerData,
  Position,
  ValuationPriceMode,
} from "@/core/models";
import type { GlobalRefreshState } from "./marketDataControlsTypes";
import type { useLanguage } from "@/ui";

export function MarketDataControlsHoldingsList({
  activeTodayKey,
  currentPositions,
  ledgerData,
  mode,
  refreshState,
  t,
}: Readonly<{
  activeTodayKey: string;
  currentPositions: Position[];
  ledgerData: LedgerData;
  mode: ValuationPriceMode;
  refreshState: GlobalRefreshState;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
        <div className="grid gap-3">
          <h3 className="font-semibold">{t("marketData.holdings.heading")}</h3>
          {currentPositions.length === 0 ? (
            <p className="text-sm text-slate-500">{t("marketData.holdings.empty")}</p>
          ) : (
            <ul className="grid gap-1 text-sm text-slate-700">
              {currentPositions.map((position) => {
                const asset = ledgerData.assets.find(
                  (candidate) => candidate.symbol === position.assetSymbol,
                );
                const selected = asset
                  ? selectPriceAsOf(
                      ledgerData.priceSnapshots,
                      asset,
                      activeTodayKey,
                      mode,
                    )
                  : undefined;
                const failure = refreshState.failures.find(
                  (item) => item.assetSymbol === position.assetSymbol,
                );
                return (
                  <li key={position.assetSymbol}>
                    <strong>{position.assetSymbol}</strong>{t("marketData.holdings.colonSeparator")}
                    {selected ? (
                      <>
                        <LedgerNumber kind="money" value={selected.snapshot.price} />{" "}
                        {selected.snapshot.currency} · {selected.actualSource === "binance"
                          ? "Binance"
                          : t("marketData.holdings.manual")} · {t("marketData.holdings.asOf")} {selected.asOf}
                      </>
                    ) : t("marketData.holdings.noValidPrice")}
                    {failure
                      ? ` · ${t("marketData.holdings.refreshFailedPrefix")}${formatBinanceFailure(failure, t)}`
                      : ""}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
  );
}
