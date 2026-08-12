"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ApplyLedgerActionResult } from "@/app";
import {
  createBinanceMarketDataClient,
  type BinanceMarketDataClient,
} from "@/platform/integrations";
import type {
  Asset,
  LedgerData,
  ValuationPriceMode,
} from "@/core/models";
import { resolveAssetBinanceMappingForRuntime } from "@/core/policies";
import {
  getBinanceMappingSignature,
  setAssetBinanceMapping,
  validateBinanceMapping,
} from "./binanceMappingService";
import {
  mergeBinancePriceRefresh,
  refreshBinancePrices,
  type BinanceAssetRefreshFailure,
} from "./binancePriceRefreshService";
import { getPositionsFromLedger } from "@/features/portfolio";
import { selectPriceAsOf } from "@/features/portfolio";
import { isZero } from "@/core/shared";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
} from "@/core/shared";
import {
  ConfirmDeleteButton,
  type ConfirmDeleteOutcome,
} from "@/ui";

const defaultClient = createBinanceMarketDataClient();

type MarketDataControlsProps = {
  ledgerData: LedgerData;
  ledgerEpoch: number;
  todayKey?: string;
  isWritable: boolean;
  mode: ValuationPriceMode;
  onModeChange: (mode: ValuationPriceMode) => void;
  applyLedgerMutation: (
    mutation: (current: LedgerData) => LedgerData,
    timeSnapshot?: ReturnType<typeof captureLedgerTime>,
  ) => ApplyLedgerActionResult;
  client?: BinanceMarketDataClient;
  clock?: LedgerClock;
  generateId?: () => string;
  showMappings?: boolean;
  showRefresh?: boolean;
  expandMappings?: boolean;
  compactMappings?: boolean;
};

type RefreshState = {
  status: "idle" | "loading" | "success" | "partial" | "error";
  message: string;
  failures: BinanceAssetRefreshFailure[];
};

const INITIAL_REFRESH_STATE: RefreshState = {
  status: "idle",
  message: "本次解锁尚未刷新 Binance 行情。",
  failures: [],
};

export function MarketDataControls({
  ledgerData,
  ledgerEpoch,
  todayKey,
  isWritable,
  mode,
  onModeChange,
  applyLedgerMutation,
  client = defaultClient,
  clock = systemLedgerClock,
  generateId = () => globalThis.crypto.randomUUID(),
  showMappings = true,
  showRefresh = true,
  expandMappings = false,
  compactMappings = false,
}: Readonly<MarketDataControlsProps>) {
  const activeTodayKey = todayKey ?? captureLedgerTime(clock).todayKey;
  const assets = ledgerData.assets;
  const hasUsdtAssets = assets.some(
    (asset) => asset.quoteCurrency === "USDT",
  );
  const mappingSignature = getBinanceMappingSignature(ledgerData);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>(
    () => createMappingDrafts(assets),
  );
  const [mappingMessages, setMappingMessages] = useState<
    Record<string, string>
  >({});
  const [editingAssetSymbol, setEditingAssetSymbol] = useState<string | null>(
    null,
  );
  const [refreshState, setRefreshState] =
    useState<RefreshState>(INITIAL_REFRESH_STATE);
  const requestIdRef = useRef(0);
  const activeAbortRef = useRef<AbortController | null>(null);
  const autoAttemptedRef = useRef(false);
  const previousEpochRef = useRef(ledgerEpoch);
  const previousMappingSignatureRef = useRef(
    mappingSignature,
  );
  const latestRef = useRef({
    ledgerData,
    ledgerEpoch,
    isWritable,
    mappingSignature,
  });
  latestRef.current = {
    ledgerData,
    ledgerEpoch,
    isWritable,
    mappingSignature,
  };

  useEffect(() => {
    setMappingDrafts(createMappingDrafts(assets));
  }, [assets]);

  useEffect(() => {
    if (previousEpochRef.current === ledgerEpoch) {
      return;
    }
    previousEpochRef.current = ledgerEpoch;
    requestIdRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    setRefreshState(INITIAL_REFRESH_STATE);
    setMappingMessages({});
    setEditingAssetSymbol(null);
  }, [ledgerEpoch]);

  useEffect(() => {
    if (previousMappingSignatureRef.current === mappingSignature) {
      return;
    }
    previousMappingSignatureRef.current = mappingSignature;
    requestIdRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    setRefreshState(INITIAL_REFRESH_STATE);
  }, [mappingSignature]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      activeAbortRef.current?.abort();
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!latestRef.current.isWritable || activeAbortRef.current) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestEpoch = latestRef.current.ledgerEpoch;
    const requestMappingSignature = latestRef.current.mappingSignature;
    const requestLedger = latestRef.current.ledgerData;
    const controller = new AbortController();
    activeAbortRef.current = controller;
    setRefreshState({
      status: "loading",
      message: "正在验证交易对并刷新 Binance 最新价格。",
      failures: [],
    });

    const result = await refreshBinancePrices(
      requestLedger,
      activeTodayKey,
      { client, clock },
      controller.signal,
    );

    if (
      requestIdRef.current !== requestId ||
      latestRef.current.ledgerEpoch !== requestEpoch ||
      latestRef.current.mappingSignature !== requestMappingSignature
    ) {
      return;
    }
    activeAbortRef.current = null;

    let appliedCount = 0;
    const acceptedTime = result.successes[0]
      ? {
          now: new Date(result.successes[0].fetchedAt),
          todayKey: result.successes[0].recordedAt,
        }
      : undefined;
    const mutationResult =
      result.successes.length === 0
        ? "noop"
        : applyLedgerMutation((current) => {
            if (
              getBinanceMappingSignature(current) !== requestMappingSignature
            ) {
              return current;
            }
            const merged = mergeBinancePriceRefresh(
              current,
              result.successes,
              generateId,
            );
            appliedCount = merged.appliedAssetSymbols.length;
            return merged.ledgerData;
          }, acceptedTime);

    if (result.successes.length > 0 && mutationResult === "rejected") {
      setRefreshState({
        status: "error",
        message: "行情已返回，但账本当前不可写；未保存任何新价格。",
        failures: result.failures,
      });
      return;
    }

    const failedCount = result.failures.length;
    setRefreshState({
      status:
        appliedCount > 0
          ? failedCount > 0
            ? "partial"
            : "success"
          : failedCount > 0
            ? "error"
            : "success",
      message:
        appliedCount === 0 && failedCount === 0
          ? "当前没有需要刷新的非零持仓映射。"
          : `已更新 ${appliedCount} 项，失败 ${failedCount} 项。`,
      failures: result.failures,
    });
  }, [activeTodayKey, applyLedgerMutation, client, clock, generateId]);

  useEffect(() => {
    if (!showRefresh || !isWritable || autoAttemptedRef.current) {
      return;
    }
    autoAttemptedRef.current = true;
    void refresh();
  }, [isWritable, refresh, showRefresh]);

  function cancelActiveRefresh() {
    requestIdRef.current += 1;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
  }

  async function saveMapping(assetSymbol: string) {
    if (!isWritable) {
      return;
    }
    cancelActiveRefresh();
    const requestEpoch = ledgerEpoch;
    const controller = new AbortController();
    activeAbortRef.current = controller;
    setMappingMessages((current) => ({
      ...current,
      [assetSymbol]: "正在向 Binance 验证交易对。",
    }));

    const result = await validateBinanceMapping(
      client,
      assetSymbol,
      mappingDrafts[assetSymbol] ?? "",
      controller.signal,
    );
    if (
      controller.signal.aborted ||
      latestRef.current.ledgerEpoch !== requestEpoch
    ) {
      return;
    }
    activeAbortRef.current = null;

    if (!result.ok) {
      setMappingMessages((current) => ({
        ...current,
        [assetSymbol]: result.error.message,
      }));
      return;
    }

    const timeSnapshot = captureLedgerTime(clock);
    const mutationResult = applyLedgerMutation(
      (current) =>
        setAssetBinanceMapping(
          current,
          assetSymbol,
          result.mapping,
          timeSnapshot.now.toISOString(),
        ),
      timeSnapshot,
    );
    if (mutationResult === "applied") {
      setEditingAssetSymbol(null);
    }
    setMappingMessages((current) => ({
      ...current,
      [assetSymbol]:
        mutationResult === "applied"
          ? "交易对已验证并加入保存队列。"
          : mutationResult === "noop"
            ? "交易对未发生变化。"
            : "账本当前不可写，交易对未保存。",
    }));
  }

  function removeMapping(assetSymbol: string): ConfirmDeleteOutcome {
    if (!isWritable) {
      return "rejected";
    }
    cancelActiveRefresh();
    const timeSnapshot = captureLedgerTime(clock);
    const mutationResult = applyLedgerMutation(
      (current) =>
        setAssetBinanceMapping(
          current,
          assetSymbol,
          null,
          timeSnapshot.now.toISOString(),
        ),
      timeSnapshot,
    );
    if (mutationResult === "applied") {
      setEditingAssetSymbol(null);
      setMappingDrafts((current) => ({ ...current, [assetSymbol]: "" }));
    }
    setMappingMessages((current) => ({
      ...current,
      [assetSymbol]:
        mutationResult === "applied"
          ? "映射已删除；历史 API 价格仍保留。"
          : mutationResult === "noop"
            ? "映射未发生变化。"
            : "账本当前不可写，映射未删除。",
    }));
    return mutationResult;
  }

  const currentPositions = getPositionsFromLedger(ledgerData, {
    todayKey: activeTodayKey,
    mode,
  }).filter((position) => !isZero(position.quantity));

  return (
    <div className="grid gap-5">
      {showRefresh ? (
      <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">估值价格模式</span>
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
            {value === "auto" ? "自动行情" : "手动价格"}
          </button>
        ))}
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !isWritable ||
            !hasUsdtAssets ||
            refreshState.status === "loading"
          }
          onClick={() => void refresh()}
          type="button"
        >
          {refreshState.status === "loading"
            ? "正在更新 Binance 行情"
            : "立即更新 Binance 行情"}
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
      ) : null}

      <div className="grid gap-2 text-sm text-slate-700">
        {showRefresh ? (
        <p>
          USDT 账本按 USDT 显示；只有兼容读取的旧 USD 与 USDT 同时汇总时，才按 <strong>1 USDT ≈ 1 USD</strong> 近似展示，未接实时汇率。旧 USD 资产不会写入新的 Binance 价格事实。
        </p>
        ) : null}
        <p>
          刷新只会把所配置的公开交易对 symbol 发送给 Binance；不会发送交易、数量、成本、密码或完整账本。
        </p>
      </div>

      {showRefresh ? (
      <div className="grid gap-3">
        <h3 className="font-semibold">当前非零持仓实际价格</h3>
        {currentPositions.length === 0 ? (
          <p className="text-sm text-slate-500">当前没有非零持仓。</p>
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
                  <strong>{position.assetSymbol}</strong>：
                  {selected
                    ? `${selected.snapshot.price} ${selected.snapshot.currency} · ${
                        selected.actualSource === "binance"
                          ? "Binance"
                          : "手动"
                      } · 截至 ${selected.asOf}`
                    : "无合法价格"}
                  {failure ? ` · 本次刷新失败：${failure.message}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      ) : null}

      {showMappings ? <details open={expandMappings}>
        <summary className="cursor-pointer font-semibold">配置 Binance Spot 交易对</summary>
        <div className="mt-3 grid gap-3">
          {compactMappings ? (
            <div className="hidden grid-cols-[7rem_1fr_1fr_auto] gap-3 px-3 text-xs font-semibold text-[var(--ledger-muted)] md:grid">
              <span>资产</span>
              <span>当前交易对</span>
              <span>验证 / 最近结果</span>
              <span>操作</span>
            </div>
          ) : null}
          {ledgerData.assets.map((asset) => {
            const currentMapping = resolveAssetBinanceMappingForRuntime(asset);
            return compactMappings ? (
            <div
              className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[7rem_1fr_1fr_auto] md:items-center"
              key={asset.id}
            >
              <p className="font-semibold">{asset.symbol}</p>
              <div>
                <p>{currentMapping?.symbol ?? "未配置"}</p>
                {editingAssetSymbol === asset.symbol ? (
                  <input
                    aria-label={`${asset.symbol} Binance 交易对`}
                    className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 uppercase"
                    disabled={!isWritable}
                    onChange={(event) =>
                      setMappingDrafts((current) => ({
                        ...current,
                        [asset.symbol]: event.target.value,
                      }))
                    }
                    placeholder={`${asset.symbol}USDT`}
                    value={mappingDrafts[asset.symbol] ?? ""}
                  />
                ) : null}
              </div>
              <div className="text-sm text-slate-600">
                <p>
                  {currentMapping
                    ? "已配置；保存前已在线验证"
                    : "尚未验证"}
                </p>
                {mappingMessages[asset.symbol] ? (
                  <p aria-live="polite" className="mt-1">
                    {mappingMessages[asset.symbol]}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {editingAssetSymbol === asset.symbol ? (
                  <>
                    <button
                      className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
                      disabled={!isWritable || activeAbortRef.current !== null}
                      onClick={() => void saveMapping(asset.symbol)}
                      type="button"
                    >
                      验证并保存
                    </button>
                    <button
                      className="rounded-md border border-slate-200 px-3 py-2 font-medium"
                      onClick={() => setEditingAssetSymbol(null)}
                      type="button"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
                    disabled={!isWritable}
                    onClick={() => setEditingAssetSymbol(asset.symbol)}
                    type="button"
                  >
                    编辑
                  </button>
                )}
                <ConfirmDeleteButton
                  ariaLabel={`删除 ${asset.symbol} Binance 映射`}
                  disabled={!isWritable || currentMapping === null}
                  label="删除映射"
                  onConfirm={() => removeMapping(asset.symbol)}
                />
              </div>
            </div>
            ) : (
            <div
              className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-[8rem_1fr_auto_auto]"
              key={asset.id}
            >
              <label className="font-medium" htmlFor={`mapping-${asset.id}`}>
                {asset.symbol}
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 uppercase"
                disabled={!isWritable}
                id={`mapping-${asset.id}`}
                onChange={(event) =>
                  setMappingDrafts((current) => ({
                    ...current,
                    [asset.symbol]: event.target.value,
                  }))
                }
                placeholder={`${asset.symbol}USDT`}
                value={mappingDrafts[asset.symbol] ?? ""}
              />
              <button
                className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!isWritable || activeAbortRef.current !== null}
                onClick={() => void saveMapping(asset.symbol)}
                type="button"
              >
                验证并保存
              </button>
              <ConfirmDeleteButton
                ariaLabel={`删除 ${asset.symbol} Binance 映射`}
                disabled={
                  !isWritable ||
                  resolveAssetBinanceMappingForRuntime(asset) === null
                }
                label="删除映射"
                onConfirm={() => removeMapping(asset.symbol)}
              />
              {mappingMessages[asset.symbol] ? (
                <p
                  aria-live="polite"
                  className="text-sm text-slate-600 md:col-start-2 md:col-span-3"
                >
                  {mappingMessages[asset.symbol]}
                </p>
              ) : null}
            </div>
            );
          })}
        </div>
      </details> : null}
    </div>
  );
}

function createMappingDrafts(
  assets: readonly Asset[],
): Record<string, string> {
  return Object.fromEntries(
    assets.map((asset) => [
      asset.symbol,
      resolveAssetBinanceMappingForRuntime(asset)?.symbol ?? "",
    ]),
  );
}
