"use client";

import type { Asset } from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import { ConfirmDeleteButton, type ConfirmDeleteOutcome } from "@/ui";
import type { AssetFeedback, Translate } from "./marketDataControlsTypes";

export function MappingRow({
  asset,
  compact,
  draft,
  editing,
  feedback,
  globalBusy,
  isWritable,
  operationActive,
  onCancel,
  onDelete,
  onDraftChange,
  onEdit,
  onRefresh,
  onSave,
  t,
}: Readonly<{
  asset: Asset;
  compact: boolean;
  draft: string;
  editing: boolean;
  feedback?: AssetFeedback;
  globalBusy: boolean;
  isWritable: boolean;
  operationActive: boolean;
  onCancel: () => void;
  onDelete: () => ConfirmDeleteOutcome;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onRefresh: () => void;
  onSave: () => void;
  t: Translate;
}>) {
  const currentMapping = resolveAssetBinanceMappingForRuntime(asset);
  const mayRestartValidation =
    operationActive && feedback?.status === "validating";
  const busy = (operationActive && !mayRestartValidation) || globalBusy;
  const input = (
    <input
      aria-label={`${asset.symbol} ${t("marketData.mappings.binancePair")}`}
      className="w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
      disabled={!isWritable || busy}
      id={`mapping-${asset.id}`}
      onChange={(event) => onDraftChange(event.target.value)}
      placeholder={`${asset.symbol}USDT`}
      value={draft}
    />
  );
  const controls = (
    <>
      {editing || !compact ? (
        <button
          className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
          disabled={!isWritable || busy}
          onClick={onSave}
          type="button"
        >
          {feedback?.status === "saving-mapping"
              ? t("marketData.mappings.savingMapping")
              : feedback?.status === "fetching-price" ||
                  feedback?.status === "saving-price"
                ? t("marketData.mappings.savingFirstPrice")
                : t("marketData.mappings.validateAndSave")}
        </button>
      ) : (
        <button
          className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
          disabled={!isWritable || busy}
          onClick={onEdit}
          type="button"
        >
          {t("marketData.mappings.edit")}
        </button>
      )}
      {editing && compact ? (
        <button
          className="rounded-md border border-slate-200 px-3 py-2 font-medium disabled:opacity-50"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          {t("marketData.mappings.cancel")}
        </button>
      ) : null}
      <button
        className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
        disabled={!isWritable || busy || currentMapping === null}
        onClick={onRefresh}
        type="button"
      >
        {t("marketData.mappings.refreshAsset")}
      </button>
      <ConfirmDeleteButton
        ariaLabel={`${t("marketData.mappings.deletePrefix")} ${asset.symbol} ${t("marketData.mappings.binanceMapping")}`}
        disabled={!isWritable || busy || currentMapping === null}
        label={t("marketData.mappings.delete")}
        onConfirm={onDelete}
      />
    </>
  );

  if (compact) {
    return (
      <div className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[7rem_1fr_1fr_auto] md:items-center">
        <p className="font-semibold">{asset.symbol}</p>
        <div className="grid gap-2">
          <p>{currentMapping?.symbol ?? t("marketData.mappings.notConfigured")}</p>
          {editing ? input : null}
        </div>
        <div className="text-sm text-slate-600">
          <p>{currentMapping ? t("marketData.mappings.explicitConfigured") : t("marketData.mappings.notConfiguredYet")}</p>
          {feedback ? (
            <p
              aria-live="polite"
              className={
                feedback.status === "error" ? "mt-1 text-red-800" : "mt-1"
              }
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">{controls}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[8rem_1fr_auto]">
      <label className="font-medium" htmlFor={`mapping-${asset.id}`}>
        {asset.symbol}
      </label>
      {input}
      <div className="flex flex-wrap gap-2">{controls}</div>
      {feedback ? (
        <p
          aria-live="polite"
          className={
            feedback.status === "error"
              ? "text-sm text-red-800 md:col-start-2 md:col-span-2"
              : "text-sm text-slate-600 md:col-start-2 md:col-span-2"
          }
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
