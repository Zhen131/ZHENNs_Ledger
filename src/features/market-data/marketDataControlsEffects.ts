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
