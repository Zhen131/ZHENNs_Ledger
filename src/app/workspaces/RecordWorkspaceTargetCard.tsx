/**
 * 这个文件管记账页最上面「记什么」那张卡片。
 * 选好之后下面显示哪张表单，由 `RecordWorkspaceFactCard.tsx` 管。
 * 没有特别的决定。
 */
"use client";

import { SurfaceCard } from "@/ui";
import type { TradeWorkspaceDraft } from "@/features/trades";
import type { LedgerData } from "@/core/models";
import type { RecordTarget } from "./workspaceDrafts";
import type { Translate } from "@/ui";

/**
 * 这个组件画记账页的「记什么」选择。
 * 可选 USDT 现金，资产转移，或某个币的买卖。
 * 选了某个币，交易表单的币种跟着换。
 * 账本不能写时选项点不了。
 */
export function RecordWorkspaceTargetCard({
  commitTradeDraft,
  isWritable,
  ledgerData,
  recordTarget,
  t,
  tradeDraft,
  updateRecordTarget,
}: Readonly<{
  commitTradeDraft: (nextDraft: TradeWorkspaceDraft) => void;
  isWritable: boolean;
  ledgerData: LedgerData;
  recordTarget: RecordTarget;
  t: Translate;
  tradeDraft: TradeWorkspaceDraft;
  updateRecordTarget: (recordTarget: RecordTarget) => void;
}>) {
  return (
      <SurfaceCard className="min-w-0 p-5">
        <label className="grid max-w-xl gap-2 text-sm font-medium">
          {t("record.target.label")}
          <select
            className="rounded-md border border-[var(--ledger-border)] bg-white px-3 py-2 font-normal"
            disabled={!isWritable}
            onChange={(event) => {
              if (event.target.value === "cash:USDT") {
                updateRecordTarget({ kind: "cash", currency: "USDT" });
                return;
              }
              if (event.target.value === "asset-transfer") {
                updateRecordTarget({ kind: "asset-transfer" });
                return;
              }
              const assetSymbol = event.target.value.slice("trade:".length);
              updateRecordTarget({ kind: "trade", assetSymbol });
              commitTradeDraft({ ...tradeDraft, assetSymbol });
            }}
            value={
              recordTarget.kind === "cash"
                ? "cash:USDT"
                : recordTarget.kind === "asset-transfer"
                  ? "asset-transfer"
                  : `trade:${recordTarget.assetSymbol}`
            }
          >
            <option value="cash:USDT">{t("record.target.cash")}</option>
            <option value="asset-transfer">{t("record.target.assetTransfer")}</option>
            {ledgerData.assets.map((asset) => (
              <option key={asset.id} value={`trade:${asset.symbol}`}>
                {asset.symbol} · {asset.name}
              </option>
            ))}
          </select>
        </label>
      </SurfaceCard>
  );
}
