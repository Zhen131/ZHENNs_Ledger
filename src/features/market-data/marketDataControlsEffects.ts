import type { Asset } from "@/core/models";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import {
  createInitialRefreshState,
  createMappingDrafts,
} from "./marketDataControlsHelpers";
import type {
  AssetFeedback,
  AssetOperation,
  GlobalOperation,
  GlobalRefreshState,
} from "./marketDataControlsTypes";
import type { useLanguage } from "@/ui";
import type { PersistenceStatus } from "@/app";

type MappingDraftSyncEffectDeps = {
  assets: Asset[];
  editingAssetSymbol: string | null;
  setMappingDrafts: Dispatch<SetStateAction<Record<string, string>>>;
};

export function runMappingDraftSyncEffect(
  deps: MappingDraftSyncEffectDeps,
) {
  const {
    assets,
    editingAssetSymbol,
    setMappingDrafts,
  } = deps;
    setMappingDrafts((current) => {
      const next = createMappingDrafts(assets);
      for (const asset of assets) {
        if (
          editingAssetSymbol === asset.symbol &&
          current[asset.symbol] !== undefined
        ) {
          next[asset.symbol] = current[asset.symbol];
        }
      }
      return next;
    });
}

type OperationInvalidationEffectDeps = {
  assetOperationIsCurrent: (operation: AssetOperation) => boolean;
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  globalOperationIsCurrent: (operation: GlobalOperation) => boolean;
  globalOperationRef: RefObject<GlobalOperation | null>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  setRefreshState: Dispatch<SetStateAction<GlobalRefreshState>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runOperationInvalidationEffect(
  deps: OperationInvalidationEffectDeps,
) {
  const {
    assetOperationIsCurrent,
    assetOperationsRef,
    globalOperationIsCurrent,
    globalOperationRef,
    setAssetFeedback,
    setRefreshState,
    t,
  } = deps;
    for (const [assetSymbol, operation] of assetOperationsRef.current) {
      if (!assetOperationIsCurrent(operation)) {
        operation.controller.abort();
        assetOperationsRef.current.delete(assetSymbol);
        setAssetFeedback((current) => {
          const next = { ...current };
          delete next[assetSymbol];
          return next;
        });
      }
    }
    const globalOperation = globalOperationRef.current;
    if (globalOperation && !globalOperationIsCurrent(globalOperation)) {
      globalOperation.controller.abort();
      globalOperationRef.current = null;
      setRefreshState(createInitialRefreshState(t));
    }
}

type PersistenceProgressEffectDeps = {
  assetOperationIsCurrent: (operation: AssetOperation) => boolean;
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  fetchAndPersistAssetPrice: (operation: AssetOperation) => Promise<void>;
  finishAssetOperation: (operation: AssetOperation, status: "saved" | "error", message: string) => void;
  finishGlobalOperation: (operation: GlobalOperation) => void;
  globalOperationIsCurrent: (operation: GlobalOperation) => boolean;
  globalOperationRef: RefObject<GlobalOperation | null>;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
  setRefreshState: Dispatch<SetStateAction<GlobalRefreshState>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runPersistenceProgressEffect(
  deps: PersistenceProgressEffectDeps,
) {
  const {
    assetOperationIsCurrent,
    assetOperationsRef,
    fetchAndPersistAssetPrice,
    finishAssetOperation,
    finishGlobalOperation,
    globalOperationIsCurrent,
    globalOperationRef,
    mutationVersion,
    persistedVersion,
    persistenceStatus,
    setAssetFeedback,
    setRefreshState,
    t,
  } = deps;
    for (const operation of assetOperationsRef.current.values()) {
      if (!assetOperationIsCurrent(operation)) continue;
      if (
        operation.phase === "saving-mapping" &&
        operation.expectedPersistedVersion !== null
      ) {
        if (
          persistenceStatus === "error" &&
          mutationVersion >= operation.expectedPersistedVersion
        ) {
          finishAssetOperation(
            operation,
            "error",
            t("marketData.assetFeedback.mappingNotPersisted"),
          );
          continue;
        }
        if (
          persistenceStatus === "saved" &&
          persistedVersion >= operation.expectedPersistedVersion
        ) {
          operation.phase = "fetching-price";
          operation.expectedPersistedVersion = null;
          setAssetFeedback((current) => ({
            ...current,
            [operation.assetSymbol]: {
              status: "fetching-price",
              message: t("marketData.assetFeedback.mappingSavedFetching"),
            },
          }));
          void fetchAndPersistAssetPrice(operation);
        }
      } else if (
        operation.phase === "saving-price" &&
        operation.expectedPersistedVersion !== null
      ) {
        if (
          persistenceStatus === "error" &&
          mutationVersion >= operation.expectedPersistedVersion
        ) {
          finishAssetOperation(
            operation,
            "error",
            operation.kind === "save-mapping"
              ? t("marketData.assetFeedback.mappingSavedPriceNotPersisted")
              : t("marketData.assetFeedback.priceNotPersisted"),
          );
          continue;
        }
        if (
          persistenceStatus === "saved" &&
          persistedVersion >= operation.expectedPersistedVersion
        ) {
          finishAssetOperation(
            operation,
            "saved",
            operation.kind === "save-mapping"
              ? t("marketData.assetFeedback.mappingAndPriceSaved")
              : t("marketData.assetFeedback.priceSaved"),
          );
        }
      }
    }

    const globalOperation = globalOperationRef.current;
    if (
      globalOperation &&
      globalOperation.expectedPersistedVersion !== null &&
      globalOperationIsCurrent(globalOperation)
    ) {
      if (
        persistenceStatus === "error" &&
        mutationVersion >= globalOperation.expectedPersistedVersion
      ) {
        globalOperation.controller.abort();
        globalOperationRef.current = null;
        setRefreshState({
          status: "error",
          message: t("marketData.assetFeedback.priceNotPersisted"),
          failures: globalOperation.failures,
        });
      } else if (
        persistenceStatus === "saved" &&
        persistedVersion >= globalOperation.expectedPersistedVersion
      ) {
        finishGlobalOperation(globalOperation);
      }
    }
}
