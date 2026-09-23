import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import type { LedgerData } from "@/core/models";
import type {
  PostImportPairingFailure,
  PostImportPairingOperation,
  PostImportPairingState,
} from "./backupControlsTypes";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import { captureLedgerTime } from "@/core/shared";
import type { ApplyLedgerActionResult } from "@/app";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { useLanguage } from "@/ui";
import {
  autoPairMissingBinanceMappings,
  getBinanceMappingSignature,
  listAssetsMissingBinanceMapping,
  mergeAutoPairedBinanceMappings,
  mergeBinancePriceRefresh,
} from "@/features/market-data";
import { normalizePairingFailure } from "./backupControlsHelpers";
import type { BinanceRefreshSuccess } from "@/features/market-data";

// BackupControls' `applyLedgerMutation` prop.
type ApplyLedgerMutation = (
  mutation: (current: LedgerData) => LedgerData,
  timeSnapshot?: LedgerTimeSnapshot,
) => ApplyLedgerActionResult;

// Shape of BackupControls' `pairingLatestRef` (inferred there from its useRef initial value).
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
  t: ReturnType<typeof useLanguage>["t"];
};

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
  t: ReturnType<typeof useLanguage>["t"];
};

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
  t: ReturnType<typeof useLanguage>["t"];
};

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
  t: ReturnType<typeof useLanguage>["t"];
};

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
