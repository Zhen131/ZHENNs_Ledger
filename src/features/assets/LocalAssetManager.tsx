"use client";

import { useEffect, useState, type FormEvent } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type { Asset, LedgerData } from "@/core/models";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import { selectPriceAsOf } from "@/features/portfolio";
import { ConfirmDeleteButton, LedgerNumber, useLanguage } from "@/ui";
import {
  ASSET_ERROR_CODES,
  createLocalAsset,
  removeLocalAsset,
  type AssetDependencySummary,
  type AssetErrorCode,
} from "./assetService";

type PendingAssetMutation = Readonly<{
  version: number;
  operation: "add" | "delete";
  symbol: string;
}>;

const SUCCESS_FEEDBACK_MS = 4_000;
type Translate = ReturnType<typeof useLanguage>["t"];

export function LocalAssetManager({
  clock = systemLedgerClock,
  ledgerData,
  ledgerEpoch,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  isWritable,
  onAssetCreated,
  onAssetDeleted,
}: Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  ledgerEpoch: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  isWritable: boolean;
  onAssetCreated: (
    asset: Asset,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  onAssetDeleted: (
    assetSymbol: string,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
}>) {
  const { t } = useLanguage();
  const [symbolInput, setSymbolInput] = useState("");
  const [error, setError] = useState<{
    code: AssetErrorCode;
    message: string;
  } | null>(null);
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState<PendingAssetMutation | null>(null);
  const todayKey = captureLedgerTime(clock).todayKey;

  useEffect(() => {
    setSymbolInput("");
    setError(null);
    setAssetErrors({});
    setFeedback("");
    setPending(null);
  }, [ledgerEpoch]);

  useEffect(() => {
    if (!pending) return;
    if (persistenceStatus === "error") {
      setError({
        code: ASSET_ERROR_CODES.DEPENDENCY_FAILURE,
        message: `${pending.symbol} ${t("assets.status.unsaved")}`,
      });
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pending.version
    ) {
      setFeedback(
        pending.operation === "add"
          ? `${pending.symbol} ${t("assets.status.saved")}`
          : `${pending.symbol} ${t("assets.status.deleted")}`,
      );
      if (pending.operation === "add") setSymbolInput("");
      setError(null);
      setPending(null);
    }
  }, [pending, persistedVersion, persistenceStatus, t]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(""), SUCCESS_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [feedback]);

  function submitAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isWritable || pending) return;
    const timeSnapshot = captureLedgerTime(clock);
    const result = createLocalAsset(symbolInput, ledgerData, {
      generateId: () => globalThis.crypto.randomUUID(),
      now: () => timeSnapshot.now.toISOString(),
    });
    if (!result.ok) {
      setError({ code: result.error.code, message: assetErrorMessage(result.error.code, t) });
      setFeedback("");
      return;
    }
    const outcome = onAssetCreated(result.asset, timeSnapshot);
    if (outcome !== "applied") {
      setError({
        code: ASSET_ERROR_CODES.DEPENDENCY_FAILURE,
        message:
          outcome === "rejected"
            ? t("assets.status.ledgerNotWritableAdd")
            : t("assets.status.unchanged"),
      });
      return;
    }
    setError(null);
    setFeedback(t("assets.status.savingAdd"));
    setPending({
      version: mutationVersion + 1,
      operation: "add",
      symbol: result.asset.symbol,
    });
  }

  function deleteAsset(asset: Asset): ApplyLedgerActionResult {
    if (!isWritable || pending) return "rejected";
    const review = removeLocalAsset(asset.symbol, ledgerData);
    if (!review.ok) {
      setAssetErrors((current) => ({
        ...current,
        [asset.symbol]: formatRemovalError(
          review.error.code,
          review.error.dependencies,
          t,
        ),
      }));
      return "rejected";
    }
    const timeSnapshot = captureLedgerTime(clock);
    const outcome = onAssetDeleted(asset.symbol, timeSnapshot);
    if (outcome === "applied") {
      setAssetErrors((current) => ({ ...current, [asset.symbol]: "" }));
      setFeedback(t("assets.status.savingDelete"));
      setPending({
        version: mutationVersion + 1,
        operation: "delete",
        symbol: asset.symbol,
      });
    } else {
      setAssetErrors((current) => ({
        ...current,
        [asset.symbol]:
          outcome === "rejected"
            ? t("assets.status.ledgerNotWritableDelete")
            : t("assets.status.notFound"),
      }));
    }
    return outcome;
  }

  return (
    <section aria-label={t("assets.workspace.ariaLabel")} className="grid gap-5">
      <div>
        <h3 className="font-semibold">{t("assets.heading")}</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          {t("assets.description")}
        </p>
      </div>

      <form className="grid gap-2 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end" onSubmit={submitAsset}>
        <label className="grid gap-2 text-sm font-medium">
          {t("assets.field.symbol")}
          <input
            aria-describedby={error ? "local-asset-error" : undefined}
            autoCapitalize="characters"
            className="rounded-md border border-slate-300 px-3 py-2 uppercase"
            disabled={!isWritable || pending !== null}
            onChange={(event) => {
              setSymbolInput(event.target.value);
              setError(null);
            }}
            placeholder={t("assets.field.symbolPlaceholder")}
            value={symbolInput}
          />
        </label>
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!isWritable || pending !== null}
          type="submit"
        >
          {pending?.operation === "add" ? t("assets.status.saving") : t("assets.action.add")}
        </button>
      </form>
      <div aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <p className="text-red-800" id="local-asset-error">
            {error.code} · {error.message}
          </p>
        ) : feedback ? (
          <p className="text-sky-800">{feedback}</p>
        ) : null}
      </div>

      <ul className="grid gap-3">
        {ledgerData.assets.map((asset) => {
          const selectedPrice = selectPriceAsOf(
            ledgerData.priceSnapshots,
            asset,
            todayKey,
            "auto",
          );
          return (
            <li
              className="grid min-w-0 gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[minmax(7rem,.7fr)_minmax(10rem,1fr)_minmax(12rem,1fr)_auto] md:items-center"
              key={asset.id}
            >
              <div>
                <p className="font-semibold">{asset.symbol}</p>
                <p className="text-xs text-slate-500">{asset.name}</p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="text-xs font-medium text-slate-500">{t("assets.binanceMapping")}</p>
                <p className="break-all">{asset.binanceMapping?.symbol ?? t("assets.unconfigured")}</p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="text-xs font-medium text-slate-500">{t("assets.currentPriceSource")}</p>
                <p className="break-words">
                  {selectedPrice ? (
                    <>
                      <LedgerNumber kind="money" value={selectedPrice.snapshot.price} />{" "}
                      USDT · {selectedPrice.actualSource === "manual" ? t("assets.manual") : "Binance"}
                    </>
                  ) : t("assets.noValidPrice")}
                </p>
              </div>
              <div className="grid gap-2 md:justify-items-end">
                <ConfirmDeleteButton
                  ariaLabel={`${t("assets.action.deleteAriaPrefix")} ${asset.symbol}`}
                  confirmLabel={t("assets.action.deleteConfirm")}
                  disabled={!isWritable || pending !== null}
                  label={t("assets.action.delete")}
                  onConfirm={() => deleteAsset(asset)}
                />
                {assetErrors[asset.symbol] ? (
                  <p
                    aria-live="polite"
                    className="max-w-md break-words text-xs leading-5 text-red-800"
                  >
                    {assetErrors[asset.symbol]}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function assetErrorMessage(code: AssetErrorCode, t: Translate): string {
  return {
    ASSET_INVALID_SYMBOL: t("assets.error.invalidSymbol"),
    ASSET_RESERVED_SYMBOL: t("assets.error.reservedSymbol"),
    ASSET_DUPLICATE_SYMBOL: t("assets.error.duplicateSymbol"),
    ASSET_NOT_FOUND: t("assets.error.notFound"),
    ASSET_DEPENDENCY_EXISTS: t("assets.error.dependencyExists"),
    ASSET_ID_GENERATION_EXHAUSTED: t("assets.error.idGenerationExhausted"),
    ASSET_DEPENDENCY_FAILURE: t("assets.error.dependencyFailure"),
    ASSET_LIMIT_REACHED: t("assets.error.limitReached"),
    ASSET_LEDGER_VALIDATION_FAILED: t("assets.error.ledgerValidationFailed"),
  }[code];
}

function formatRemovalError(
  code: AssetErrorCode,
  dependencies: readonly AssetDependencySummary[] | undefined,
  t: Translate,
): string {
  if (code !== ASSET_ERROR_CODES.DEPENDENCY_EXISTS || !dependencies) {
    return `${code} · ${assetErrorMessage(code, t)}`;
  }
  const labels = {
    trades: t("assets.dependency.trades"),
    assetTransfers: t("assets.dependency.assetTransfers"),
    priceSnapshots: t("assets.dependency.priceSnapshots"),
    feeRules: t("assets.dependency.feeRules"),
  };
  return `${code} · ${t("assets.dependency.removeFirst")}${dependencies
    .map(
      (item) =>
        `${labels[item.collection]} ${item.count} ${t("assets.dependency.itemSuffix")}（${item.paths.join(t("assets.separator.join"))}）`,
    )
    .join(t("assets.separator.item"))}`;
}
