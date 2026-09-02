import type { AssetTransfer, PriceSnapshot, Trade } from "@/core/models";
import {
  ConfirmDeleteButton,
  LedgerNumber,
  useLanguage,
  type ConfirmDeleteOutcome,
} from "@/ui";
import { shortLedgerId } from "./DashboardShellHelpers";

export function FutureCorrectionPanel({
  canCorrectFutureFacts,
  futureAssetTransfers,
  futureCorrectionError,
  futurePriceSnapshots,
  futureTrades,
  handleDeleteAllFutureFacts,
  handleDeleteFutureAssetTransfer,
  handleDeleteFuturePrice,
  handleDeleteFutureTrade,
  t,
}: Readonly<{
  canCorrectFutureFacts: boolean;
  futureAssetTransfers: AssetTransfer[];
  futureCorrectionError: string;
  futurePriceSnapshots: PriceSnapshot[];
  futureTrades: Trade[];
  handleDeleteAllFutureFacts: () => ConfirmDeleteOutcome;
  handleDeleteFutureAssetTransfer: (assetTransferId: string) => ConfirmDeleteOutcome;
  handleDeleteFuturePrice: (priceSnapshotId: string) => ConfirmDeleteOutcome;
  handleDeleteFutureTrade: (tradeId: string) => ConfirmDeleteOutcome;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
            <div className="mb-5 grid gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950">
              <p className="font-semibold">{t("dashboard.futureFacts.heading")}</p>
              <p>
                {t("dashboard.futureFacts.description")}
              </p>
              {futureCorrectionError ? (
                <p
                  aria-live="polite"
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-red-900"
                >
                  {futureCorrectionError}
                </p>
              ) : null}
              <ul className="grid gap-1">
                {futureTrades.map((trade) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-white p-3"
                    key={trade.id}
                  >
                    <span>
                      {t("dashboard.futureFacts.trade")}{t("dashboard.futureFacts.colonSeparator")}{trade.type === "buy" ? t("trades.type.buy") : t("trades.type.sell")} ·{" "}
                      {trade.assetSymbol} · {t("dashboard.futureFacts.quantity")} {" "}
                      <LedgerNumber kind="quantity" value={trade.quantity} /> · {t("dashboard.futureFacts.price")} {" "}
                      <LedgerNumber kind="money" value={trade.price} />{" "}
                      {trade.currency} · {trade.occurredAt} · ID{" "}
                      {shortLedgerId(trade.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`${t("dashboard.futureFacts.deleteTrade")} ${trade.assetSymbol} ${trade.occurredAt} ${trade.id}`}
                      disabled={!canCorrectFutureFacts}
                      label={t("dashboard.futureFacts.deleteTrade")}
                      onConfirm={() => handleDeleteFutureTrade(trade.id)}
                    />
                  </li>
                ))}
                {futurePriceSnapshots.map((snapshot) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-white p-3"
                    key={snapshot.id}
                  >
                    <span>
                      {t("dashboard.futureFacts.priceSnapshot")}{t("dashboard.futureFacts.colonSeparator")}{snapshot.assetSymbol} ·{" "}
                      <LedgerNumber kind="money" value={snapshot.price} />{" "}
                      {snapshot.currency} · {t("dashboard.futureFacts.source")} {" "}
                      {snapshot.source === "api" ? "Binance API" : t("dashboard.futureFacts.manual")} ·{" "}
                      {snapshot.recordedAt} · ID {shortLedgerId(snapshot.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`${t("dashboard.futureFacts.deletePrice")} ${snapshot.assetSymbol} ${snapshot.recordedAt} ${snapshot.id}`}
                      disabled={!canCorrectFutureFacts}
                      label={t("dashboard.futureFacts.deletePrice")}
                      onConfirm={() =>
                        handleDeleteFuturePrice(snapshot.id)
                      }
                    />
                  </li>
                ))}
                {futureAssetTransfers.map((assetTransfer) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-white p-3"
                    key={assetTransfer.id}
                  >
                    <span>
                      {t("dashboard.futureFacts.assetTransfer")}{t("dashboard.futureFacts.colonSeparator")}{assetTransfer.assetSymbol} · {t("dashboard.futureFacts.quantity")} {" "}
                      <LedgerNumber
                        kind="quantity"
                        value={assetTransfer.quantity}
                      />{" "}
                      · {assetTransfer.occurredAt} · ID{" "}
                      {shortLedgerId(assetTransfer.id)}
                    </span>
                    <ConfirmDeleteButton
                      ariaLabel={`${t("dashboard.futureFacts.deleteAssetTransfer")} ${assetTransfer.assetSymbol} ${assetTransfer.occurredAt} ${assetTransfer.id}`}
                      disabled={!canCorrectFutureFacts}
                      label={t("dashboard.futureFacts.deleteAssetTransfer")}
                      onConfirm={() =>
                        handleDeleteFutureAssetTransfer(assetTransfer.id)
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="w-fit">
                <ConfirmDeleteButton
                  ariaLabel={t("dashboard.futureFacts.deleteAll")}
                  disabled={!canCorrectFutureFacts}
                  label={t("dashboard.futureFacts.deleteAll")}
                  onConfirm={handleDeleteAllFutureFacts}
                />
              </div>
            </div>
  );
}
