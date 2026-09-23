import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  AssetFeedback,
  AssetOperation,
} from "./marketDataControlsTypes";

type CancelAssetOperationDeps = {
  assetOperationsRef: RefObject<Map<string, AssetOperation>>;
  mountedRef: RefObject<boolean>;
  setAssetFeedback: Dispatch<SetStateAction<Record<string, AssetFeedback>>>;
};

export function doCancelAssetOperation(
  deps: CancelAssetOperationDeps,
  assetSymbol: string,
  resetFeedback: boolean,
) {
  const {
    assetOperationsRef,
    mountedRef,
    setAssetFeedback,
  } = deps;
      const operation = assetOperationsRef.current.get(assetSymbol);
      if (!operation) return;
      operation.controller.abort();
      assetOperationsRef.current.delete(assetSymbol);
      if (resetFeedback && mountedRef.current) {
        setAssetFeedback((current) => {
          const next = { ...current };
          delete next[assetSymbol];
          return next;
        });
      }
}
