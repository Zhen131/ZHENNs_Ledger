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
import { ConfirmDeleteButton } from "@/ui";
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
        message: `${pending.symbol} 变更已进入内存，但尚未保存；请重试保存`,
      });
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pending.version
    ) {
      setFeedback(
        pending.operation === "add"
          ? `${pending.symbol} 已作为本地资产保存`
          : `${pending.symbol} 本地资产已删除`,
      );
      if (pending.operation === "add") setSymbolInput("");
      setError(null);
      setPending(null);
    }
  }, [pending, persistedVersion, persistenceStatus]);

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
      setError({ code: result.error.code, message: assetErrorMessage(result.error.code) });
      setFeedback("");
      return;
    }
    const outcome = onAssetCreated(result.asset, timeSnapshot);
    if (outcome !== "applied") {
      setError({
        code: ASSET_ERROR_CODES.DEPENDENCY_FAILURE,
        message:
          outcome === "rejected"
            ? "账本当前不可写，本地资产未新增"
            : "本地资产未发生变化",
      });
      return;
    }
    setError(null);
    setFeedback("正在保存本地资产…");
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
        ),
      }));
      return "rejected";
    }
    const timeSnapshot = captureLedgerTime(clock);
    const outcome = onAssetDeleted(asset.symbol, timeSnapshot);
    if (outcome === "applied") {
      setAssetErrors((current) => ({ ...current, [asset.symbol]: "" }));
      setFeedback("正在保存资产删除…");
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
            ? "账本当前不可写，资产未删除"
            : "资产已不在当前账本中",
      }));
    }
    return outcome;
  }

  return (
    <section aria-label="本地资产与行情" className="grid gap-5">
      <div>
        <h3 className="font-semibold">本地资产与行情</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--ledger-muted)]">
          新增只保存本地代码，不会访问 Binance。没有交易对的资产仍可记账并录入手动 USDT 价格。
        </p>
      </div>

      <form className="grid gap-2 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end" onSubmit={submitAsset}>
        <label className="grid gap-2 text-sm font-medium">
          新增本地资产代码
          <input
            aria-describedby={error ? "local-asset-error" : undefined}
            autoCapitalize="characters"
            className="rounded-md border border-slate-300 px-3 py-2 uppercase"
            disabled={!isWritable || pending !== null}
            onChange={(event) => {
              setSymbolInput(event.target.value);
              setError(null);
            }}
            placeholder="例如 SOL 或 KNIGHT"
            value={symbolInput}
          />
        </label>
        <button
          className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!isWritable || pending !== null}
          type="submit"
        >
          {pending?.operation === "add" ? "正在保存…" : "新增本地资产"}
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
                <p className="text-xs font-medium text-slate-500">Binance 映射</p>
                <p className="break-all">{asset.binanceMapping?.symbol ?? "未配置"}</p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="text-xs font-medium text-slate-500">当前价格来源</p>
                <p className="break-words">
                  {selectedPrice
                    ? `${selectedPrice.snapshot.price} USDT · ${
                        selectedPrice.actualSource === "manual"
                          ? "手动"
                          : "Binance"
                      }`
                    : "无合法价格"}
                </p>
              </div>
              <div className="grid gap-2 md:justify-items-end">
                <ConfirmDeleteButton
                  ariaLabel={`删除本地资产 ${asset.symbol}`}
                  confirmLabel="再次点击删除资产"
                  disabled={!isWritable || pending !== null}
                  label="删除资产"
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

function assetErrorMessage(code: AssetErrorCode): string {
  return {
    ASSET_INVALID_SYMBOL: "代码需为 1–32 位英文大写字母或数字",
    ASSET_RESERVED_SYMBOL: "USDT 专用于现金池，不能作为本地资产",
    ASSET_DUPLICATE_SYMBOL: "规范化后的资产代码已存在",
    ASSET_NOT_FOUND: "资产已不在当前账本中",
    ASSET_DEPENDENCY_EXISTS: "资产仍被账本事实引用",
    ASSET_ID_GENERATION_EXHAUSTED: "连续三次未能生成唯一资产 ID",
    ASSET_DEPENDENCY_FAILURE: "无法完成本地资产操作",
    ASSET_LIMIT_REACHED: "资产数量已达 500 项上限",
    ASSET_LEDGER_VALIDATION_FAILED: "新资产未通过完整账本校验",
  }[code];
}

function formatRemovalError(
  code: AssetErrorCode,
  dependencies: readonly AssetDependencySummary[] | undefined,
): string {
  if (code !== ASSET_ERROR_CODES.DEPENDENCY_EXISTS || !dependencies) {
    return `${code} · ${assetErrorMessage(code)}`;
  }
  const labels = {
    trades: "交易或非 USDT 手续费",
    priceSnapshots: "价格事实",
    feeRules: "手续费规则",
  };
  return `${code} · 请先删除：${dependencies
    .map(
      (item) =>
        `${labels[item.collection]} ${item.count} 项（${item.paths.join("、")}）`,
    )
    .join("；")}`;
}
