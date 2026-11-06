/**
 * 这个文件放行情区的四件「事后要做的事」。
 * 同步草稿、作废旧操作、跟存盘走、收尾。
 * 它们什么时候触发由 `MarketDataControls.tsx` 定。
 * 不显然的决定：换账本、锁定、离开页面，联网都作废。
 * 这条 2026-08-19 定（W14 01B 第 5.4 节）。
 */
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
import type { Translate } from "@/ui";
import type { PersistenceStatus } from "@/app";

type MappingDraftSyncEffectDeps = {
  assets: Asset[];
  editingAssetSymbol: string | null;
  setMappingDrafts: Dispatch<SetStateAction<Record<string, string>>>;
};

/**
 * 这个函数在币的清单变了后，重新填好每个交易对输入框。
 * 正在编辑的那一个保留人填的字，不覆盖。
 */
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
  t: Translate;
};

/**
 * 这个函数把已经不算数的操作取消掉，并清掉对应的提示。
 * 单币操作和全局刷新都查。
 */
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
  t: Translate;
};

/**
 * 这个函数看存盘结果，推动操作往下走。
 * 交易对存好了：去取价格。
 * 价格存好了：显示「已保存」。
 * 存盘失败：结束并说明没存上的是什么。
 */
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

type MarketDataMountEffectDeps = {
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  globalOperationRef: RefObject<GlobalOperation | null>;
  mountedRef: RefObject<boolean>;
};

/**
 * 这个函数在行情区出现时记下「在了」。
 * 它返回离开时的收尾。
 * 离开时取消所有进行中的联网操作。
 */
export function runMarketDataMountEffect(
  deps: MarketDataMountEffectDeps,
) {
  const {
    assetOperationsRef,
    globalOperationRef,
    mountedRef,
  } = deps;
    mountedRef.current = true;
    const assetOperations = assetOperationsRef.current;
    return () => {
      mountedRef.current = false;
      for (const operation of assetOperations.values()) {
        operation.controller.abort();
      }
      assetOperations.clear();
      globalOperationRef.current?.controller.abort();
      globalOperationRef.current = null;
    };
}
