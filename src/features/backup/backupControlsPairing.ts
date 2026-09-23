import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import type { LedgerData } from "@/core/models";
import type {
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
} from "@/features/market-data";
import { normalizePairingFailure } from "./backupControlsHelpers";

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
