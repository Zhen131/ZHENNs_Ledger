/**
 * 这个文件管导入 B 之后的「联网配币安对」。
 * 分四步：验证、存映射、取价格、存价格。
 * 联网和合并的细节交给 market-data 功能区。
 * 不显然的决定：要人点按钮才联网，映射存上后才去取价格；2026-08-19 定（W14 01B 第 5.3 节）。
 */
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import type { LedgerData } from "@/core/models";
import type {
  ApplyLedgerMutation,
  PostImportPairingFailure,
  PostImportPairingOperation,
  PostImportPairingState,
} from "./backupControlsTypes";
import type {
  LedgerClock,
} from "@/core/shared";
import { captureLedgerTime } from "@/core/shared";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { Translate } from "@/ui";
import {
  autoPairMissingBinanceMappings,
  getBinanceMappingSignature,
  listAssetsMissingBinanceMapping,
  mergeAutoPairedBinanceMappings,
  mergeBinancePriceRefresh,
} from "@/features/market-data";
import { normalizePairingFailure } from "./backupControlsHelpers";
import type { BinanceRefreshSuccess } from "@/features/market-data";

/**
 * `BackupControls` 里 `pairingLatestRef` 存的那份最新状态的样子。
 * 那边的类型是从初始值推出来的，这里照着写一份。
 */
type PairingLatest = {
  ledgerData: LedgerData;
  ledgerEpoch: number;
  sessionGeneration: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  isWritable: boolean;
};

type PairingOperationIsCurrentDeps = {
  mountedRef: RefObject<boolean>;
  pairingLatestRef: RefObject<PairingLatest>;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
};

/**
 * 这个函数回答：这次配对还算数吗？
 * 页面还在、没有新的配对、账本还能写、没换账本，才算数。
 */
export function doPairingOperationIsCurrent(
  deps: PairingOperationIsCurrentDeps,
  operation: PostImportPairingOperation,
): boolean {
  const {
    mountedRef,
    pairingLatestRef,
    pairingOperationRef,
  } = deps;
    const latest = pairingLatestRef.current;
    return (
      mountedRef.current &&
      pairingOperationRef.current === operation &&
      latest.isWritable &&
      latest.ledgerEpoch === operation.ledgerEpoch &&
      latest.sessionGeneration === operation.sessionGeneration
    );
}

type StartPostImportPairingDeps = {
  applyLedgerMutation: ApplyLedgerMutation | undefined;
  clock: LedgerClock;
  finishPostImportPairing: (operation: PostImportPairingOperation, status: "success" | "partial" | "error", message: string) => void;
  marketDataClient: BinanceMarketDataClient;
  pairingLatestRef: RefObject<PairingLatest>;
  pairingOperationIsCurrent: (operation: PostImportPairingOperation) => boolean;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  postImportPairing: PostImportPairingState | null;
  setPostImportPairing: Dispatch<SetStateAction<PostImportPairingState | null>>;
  t: Translate;
};

/**
 * 这个函数处理「联网自动配对」。
 * 先把要配的币冻住，只配仍然没有映射的。
 * 举例：提示 SOL、DOGE 要配，SOL 已经手动配好 → 只配 DOGE。
 * 验证成功的一次性写进账本，然后等存盘。
 * 写进去前发现映射被别处改过，就不写。
 * 全部失败或写不进去：结束并说明原因。
 */
export async function doStartPostImportPairing(
  deps: StartPostImportPairingDeps,
) {
  const {
    applyLedgerMutation,
    clock,
    finishPostImportPairing,
    marketDataClient,
    pairingLatestRef,
    pairingOperationIsCurrent,
    pairingOperationRef,
    postImportPairing,
    setPostImportPairing,
    t,
  } = deps;
    const currentPrompt = postImportPairing;
    const latest = pairingLatestRef.current;
    if (
      !currentPrompt ||
      pairingOperationRef.current ||
      !latest.isWritable ||
      !applyLedgerMutation
    ) {
      return;
    }
    const currentMissing = new Set(
      listAssetsMissingBinanceMapping(latest.ledgerData),
    );
    const frozenSymbols = currentPrompt.symbols.filter((symbol) =>
      currentMissing.has(symbol),
    );
    if (frozenSymbols.length === 0) {
      setPostImportPairing({
        ...currentPrompt,
        status: "success",
      message: t("backup.pairing.allMappingsPresent"),
        failures: [],
      });
      return;
    }

    const operation: PostImportPairingOperation = {
      controller: new AbortController(),
      ledgerEpoch: latest.ledgerEpoch,
      sessionGeneration: latest.sessionGeneration,
      phase: "validating",
      expectedPersistedVersion: null,
      expectedMappingSignature: getBinanceMappingSignature(latest.ledgerData),
      mappingSuccesses: [],
      mappingFailures: [],
      appliedMappingSymbols: [],
      appliedPriceCount: 0,
      priceFailures: [],
    };
    pairingOperationRef.current = operation;
    setPostImportPairing({
      symbols: frozenSymbols,
      status: "validating",
      message: `${t("backup.pairing.validatingPrefix")}${frozenSymbols.length}${t("backup.pairing.validatingSuffix")}`,
      failures: [],
    });

    let result;
    try {
      result = await autoPairMissingBinanceMappings(
        marketDataClient,
        frozenSymbols,
        operation.controller.signal,
      );
    } catch {
      if (pairingOperationIsCurrent(operation)) {
        finishPostImportPairing(
          operation,
          "error",
          t("backup.pairing.validationFailed"),
        );
      }
      return;
    }
    if (!pairingOperationIsCurrent(operation)) return;

    operation.mappingFailures = result.failures.map((failure) =>
      normalizePairingFailure(failure, t),
    );
    if (result.successes.length === 0) {
      finishPostImportPairing(
        operation,
        "error",
        `${t("backup.pairing.noMappingPrefix")}${result.failures.length}${t("backup.pairing.noMappingSuffix")}`,
      );
      return;
    }

    const acceptedTime = captureLedgerTime(clock);
    const expectedVersion = pairingLatestRef.current.mutationVersion + 1;
    let appliedSymbols: string[] = [];
    let expectedSignature = operation.expectedMappingSignature;
    const mutationResult = applyLedgerMutation(
      (current) => {
        if (
          getBinanceMappingSignature(current) !==
          operation.expectedMappingSignature
        ) {
          return current;
        }
        const merged = mergeAutoPairedBinanceMappings(
          current,
          result.successes,
          acceptedTime.now.toISOString(),
        );
        appliedSymbols = merged.appliedAssetSymbols;
        expectedSignature = getBinanceMappingSignature(merged.ledgerData);
        return merged.ledgerData;
      },
      acceptedTime,
    );
    if (!pairingOperationIsCurrent(operation)) return;

    operation.appliedMappingSymbols = appliedSymbols;
    operation.mappingSuccesses = result.successes.filter((success) =>
      appliedSymbols.includes(success.assetSymbol),
    );
    operation.expectedMappingSignature = expectedSignature;
    if (mutationResult === "applied" && appliedSymbols.length > 0) {
      operation.phase = "saving-mappings";
      operation.expectedPersistedVersion = expectedVersion;
      setPostImportPairing({
        symbols: frozenSymbols,
        status: "saving-mappings",
        message: `${t("backup.pairing.validatedPrefix")}${appliedSymbols.length}${t("backup.pairing.validatedSuffix")}`,
        failures: operation.mappingFailures,
      });
      return;
    }

    operation.mappingFailures.push(
      ...result.successes.map(({ assetSymbol }) => ({
        assetSymbol,
        code: "BINANCE_MAPPING_NOT_APPLIED",
        message: t("backup.pairing.validationNotWritten"),
      })),
    );

    finishPostImportPairing(
      operation,
      operation.mappingFailures.length > 0 ? "partial" : "error",
      t("backup.pairing.mappingNotSaved"),
    );
}

type FetchPostImportPricesDeps = {
  applyLedgerMutation: ApplyLedgerMutation | undefined;
  clock: LedgerClock;
  completePostImportPairing: (operation: PostImportPairingOperation) => void;
  generateId: () => string;
  marketDataClient: BinanceMarketDataClient;
  pairingLatestRef: RefObject<PairingLatest>;
  pairingOperationIsCurrent: (operation: PostImportPairingOperation) => boolean;
  setPostImportPairing: Dispatch<SetStateAction<PostImportPairingState | null>>;
  t: Translate;
};

/**
 * 这个函数在映射存好后，一次取回这些币的最新价格。
 * 取到的价格合并成当天的币安价，再等存盘。
 * 举例：配好 DOGE，取到 0.12 → 账本多一条 DOGE 当天的币安价。
 * 联网出错、取不到的币都记成失败，已存的映射不回滚。
 */
export async function doFetchPostImportPrices(
  deps: FetchPostImportPricesDeps,
  operation: PostImportPairingOperation,
) {
  const {
    applyLedgerMutation,
    clock,
    completePostImportPairing,
    generateId,
    marketDataClient,
    pairingLatestRef,
    pairingOperationIsCurrent,
    setPostImportPairing,
    t,
  } = deps;
    if (!pairingOperationIsCurrent(operation)) return;
    const marketSymbolToAsset = new Map(
      operation.mappingSuccesses.map((success) => [
        success.mapping.symbol,
        success.assetSymbol,
      ]),
    );
    let tickerResult;
    try {
      tickerResult = await marketDataClient.fetchLatestPrices(
        [...marketSymbolToAsset.keys()],
        operation.controller.signal,
      );
    } catch {
      if (pairingOperationIsCurrent(operation)) {
        operation.priceFailures = operation.mappingSuccesses.map(
          ({ assetSymbol }) => ({
            assetSymbol,
            code: "BINANCE_NETWORK_ERROR",
            message: t("backup.pairing.priceRequestFailed"),
          }),
        );
        completePostImportPairing(operation);
      }
      return;
    }
    if (!pairingOperationIsCurrent(operation)) return;

    const acceptedTime = captureLedgerTime(clock);
    const successes: BinanceRefreshSuccess[] = [];
    const failures: PostImportPairingFailure[] = tickerResult.failures.map(
      (failure) => ({
        assetSymbol:
          marketSymbolToAsset.get(failure.symbol) ?? failure.symbol,
        code: failure.code,
        message: failure.message,
      }),
    );
    const failedMarketSymbols = new Set(
      tickerResult.failures.map((failure) => failure.symbol),
    );
    for (const mappingSuccess of operation.mappingSuccesses) {
      if (failedMarketSymbols.has(mappingSuccess.mapping.symbol)) continue;
      const ticker = tickerResult.prices.find(
        (price) => price.symbol === mappingSuccess.mapping.symbol,
      );
      if (!ticker) {
        failures.push({
          assetSymbol: mappingSuccess.assetSymbol,
          code: "BINANCE_SYMBOL_MISSING",
          message: t("backup.pairing.tickerMissing"),
        });
        continue;
      }
      successes.push({
        assetSymbol: mappingSuccess.assetSymbol,
        mapping: mappingSuccess.mapping,
        price: ticker.price,
        recordedAt: acceptedTime.todayKey,
        fetchedAt: acceptedTime.now.toISOString(),
      });
    }
    operation.priceFailures = failures;
    if (successes.length === 0) {
      completePostImportPairing(operation);
      return;
    }

    const expectedVersion = pairingLatestRef.current.mutationVersion + 1;
    let appliedCount = 0;
    let skippedSymbols: string[] = [];
    const mutationResult = applyLedgerMutation?.(
      (current) => {
        if (
          getBinanceMappingSignature(current) !==
          operation.expectedMappingSignature
        ) {
          return current;
        }
        const merged = mergeBinancePriceRefresh(
          current,
          successes,
          generateId,
        );
        appliedCount = merged.appliedAssetSymbols.length;
        skippedSymbols = merged.skippedAssetSymbols;
        return merged.ledgerData;
      },
      acceptedTime,
    );
    if (!pairingOperationIsCurrent(operation)) return;
    operation.appliedPriceCount = appliedCount;
    operation.priceFailures.push(
      ...skippedSymbols.map((assetSymbol) => ({
        assetSymbol,
        code: "BINANCE_PRICE_NOT_APPLIED",
        message: t("backup.pairing.priceNotWritten"),
      })),
    );
    if (mutationResult === "applied" && appliedCount > 0) {
      operation.phase = "saving-prices";
      operation.expectedPersistedVersion = expectedVersion;
      setPostImportPairing((current) =>
        current
          ? {
              ...current,
              status: "saving-prices",
              message: `${t("backup.pairing.pricesFetchedPrefix")}${appliedCount}${t("backup.pairing.pricesFetchedSuffix")}`,
              failures: [
                ...operation.mappingFailures,
                ...operation.priceFailures,
              ],
            }
          : current,
      );
      return;
    }
    const failedPriceAssets = new Set(
      operation.priceFailures.map(({ assetSymbol }) => assetSymbol),
    );
    operation.priceFailures.push(
      ...successes
        .filter(({ assetSymbol }) => !failedPriceAssets.has(assetSymbol))
        .map(({ assetSymbol }) => ({
          assetSymbol,
          code: "BINANCE_PRICE_NOT_APPLIED",
          message: t("backup.pairing.priceNotWrittenByLedger"),
        })),
    );
    completePostImportPairing(operation);
}

type CompletePostImportPairingDeps = {
  finishPostImportPairing: (operation: PostImportPairingOperation, status: "success" | "partial" | "error", message: string) => void;
  pairingOperationIsCurrent: (operation: PostImportPairingOperation) => boolean;
  t: Translate;
};

/** 这个函数给这次配对下结论：全成、部分成、全失败。 */
export function doCompletePostImportPairing(
  deps: CompletePostImportPairingDeps,
  operation: PostImportPairingOperation,
) {
  const {
    finishPostImportPairing,
    pairingOperationIsCurrent,
    t,
  } = deps;
    if (!pairingOperationIsCurrent(operation)) return;
    const failures = [
      ...operation.mappingFailures,
      ...operation.priceFailures,
    ];
    const successfulMutationCount =
      operation.appliedMappingSymbols.length + operation.appliedPriceCount;
    finishPostImportPairing(
      operation,
      failures.length === 0
        ? "success"
        : successfulMutationCount > 0
          ? "partial"
          : "error",
      `${t("backup.pairing.completePrefix")}${operation.appliedMappingSymbols.length}${t("backup.pairing.completeMappingMiddle")}${operation.appliedPriceCount}${t("backup.pairing.completePriceMiddle")}${failures.length}${t("backup.pairing.completeSuffix")}`,
    );
}

type FinishPostImportPairingDeps = {
  pairingOperationIsCurrent: (operation: PostImportPairingOperation) => boolean;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  setPostImportPairing: Dispatch<SetStateAction<PostImportPairingState | null>>;
};

/** 这个函数结束这次配对，写上结论、说明和全部失败清单。 */
export function doFinishPostImportPairing(
  deps: FinishPostImportPairingDeps,
  operation: PostImportPairingOperation,
  status: "success" | "partial" | "error",
  message: string,
) {
  const {
    pairingOperationIsCurrent,
    pairingOperationRef,
    setPostImportPairing,
  } = deps;
    if (!pairingOperationIsCurrent(operation)) return;
    pairingOperationRef.current = null;
    setPostImportPairing((current) =>
      current
        ? {
            ...current,
            status,
            message,
            failures: [
              ...operation.mappingFailures,
              ...operation.priceFailures,
            ],
          }
        : current,
    );
}

type PairingInvalidationEffectDeps = {
  mountedRef: RefObject<boolean>;
  pairingOperationIsCurrent: (operation: PostImportPairingOperation) => boolean;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  setPostImportPairing: Dispatch<SetStateAction<PostImportPairingState | null>>;
  t: Translate;
};

/**
 * 这个函数取消正在进行的配对。
 * 账本换了、锁了、不能写了时用。
 * 取消后显示「已取消」。
 */
export function runPairingInvalidationEffect(
  deps: PairingInvalidationEffectDeps,
) {
  const {
    mountedRef,
    pairingOperationIsCurrent,
    pairingOperationRef,
    setPostImportPairing,
    t,
  } = deps;
    const operation = pairingOperationRef.current;
    if (operation && !pairingOperationIsCurrent(operation)) {
      operation.controller.abort();
      pairingOperationRef.current = null;
      if (mountedRef.current) {
        setPostImportPairing((current) =>
          current
            ? {
                ...current,
                status: "error",
                message:
                  t("backup.pairing.cancelled"),
              }
            : current,
        );
      }
    }
}

type PairingPersistenceEffectDeps = {
  completePostImportPairing: (operation: PostImportPairingOperation) => void;
  fetchPostImportPrices: (operation: PostImportPairingOperation) => Promise<void>;
  finishPostImportPairing: (operation: PostImportPairingOperation, status: "success" | "partial" | "error", message: string) => void;
  mutationVersion: number;
  pairingOperationIsCurrent: (operation: PostImportPairingOperation) => boolean;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  persistedVersion: number;
  persistenceStatus: "error" | "idle" | "saving" | "saved";
  setPostImportPairing: Dispatch<SetStateAction<PostImportPairingState | null>>;
  t: Translate;
};

/**
 * 这个函数看存盘结果，推动配对往下走。
 * 映射存好了：去取价格。
 * 价格存好了：下结论。
 * 存盘失败：结束并说明没存上的是映射还是价格。
 */
export function runPairingPersistenceEffect(
  deps: PairingPersistenceEffectDeps,
) {
  const {
    completePostImportPairing,
    fetchPostImportPrices,
    finishPostImportPairing,
    mutationVersion,
    pairingOperationIsCurrent,
    pairingOperationRef,
    persistedVersion,
    persistenceStatus,
    setPostImportPairing,
    t,
  } = deps;
    const operation = pairingOperationRef.current;
    if (
      !operation ||
      operation.expectedPersistedVersion === null ||
      !pairingOperationIsCurrent(operation)
    ) {
      return;
    }

    if (
      persistenceStatus === "error" &&
      mutationVersion >= operation.expectedPersistedVersion
    ) {
      finishPostImportPairing(
        operation,
        "error",
        operation.phase === "saving-mappings"
          ? t("backup.pairing.mappingNotPersisted")
          : t("backup.pairing.priceNotPersisted"),
      );
      return;
    }

    if (
      persistenceStatus === "saved" &&
      persistedVersion >= operation.expectedPersistedVersion
    ) {
      operation.expectedPersistedVersion = null;
      if (operation.phase === "saving-mappings") {
        operation.phase = "fetching-prices";
        setPostImportPairing((current) =>
          current
            ? {
                ...current,
                status: "fetching-prices",
                message: t("backup.pairing.mappingSavedFetching"),
              }
            : current,
        );
        void fetchPostImportPrices(operation);
      } else if (operation.phase === "saving-prices") {
        completePostImportPairing(operation);
      }
    }
}
