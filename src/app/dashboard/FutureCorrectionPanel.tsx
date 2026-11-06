/**
 * 这个文件管账本里有未来日期记录时出现的修正面板。
 * 删除动作本身在 `dashboardShellActions.ts`。
 * 不显然的决定：新记录不许晚于今天，2026-08-19 定（W14 01B 第 3.5 节）。
 * 有未来记录时只许删，2026-07-25 提交 329dd82 起这样做。
 */
import type { AssetTransfer, PriceSnapshot, Trade } from "@/core/models";
import {
  ConfirmDeleteButton,
  LedgerNumber,
  type ConfirmDeleteOutcome,
  type Translate,
} from "@/ui";
import { shortLedgerId } from "./DashboardShellHelpers";

/**
 * 这个组件画未来记录的修正面板。
 * 它画在当前页面最上方，五个页面都有。
 * 它列出未来日期的买卖，资产转移，价格，每条能单独删。
 * 也有一个按钮一次全部删掉。删掉之前，别的页面都不能改账。
 */
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
  t: Translate;
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
