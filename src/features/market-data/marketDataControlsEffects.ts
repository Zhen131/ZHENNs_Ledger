import type { Asset } from "@/core/models";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import { createMappingDrafts } from "./marketDataControlsHelpers";

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
