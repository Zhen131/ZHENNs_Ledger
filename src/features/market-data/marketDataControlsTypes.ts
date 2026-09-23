import type { BinanceMarketMapping } from "@/core/models";
import type { useLanguage } from "@/ui";
import { type BinanceAssetRefreshFailure } from "./binancePriceRefreshService";

export type AssetOperationKind = "save-mapping" | "refresh-price";
type AssetOperationPhase =
  | "validating"
  | "saving-mapping"
  | "fetching-price"
  | "saving-price";
export type AssetOperation = {
  id: number;
  kind: AssetOperationKind;
  phase: AssetOperationPhase;
  controller: AbortController;
  ledgerEpoch: number;
  sessionGeneration: number;
  assetId: string;
  assetSymbol: string;
  startMappingSignature: string;
  expectedMappingSignature: string;
  mapping: BinanceMarketMapping | null;
  expectedPersistedVersion: number | null;
};

type AssetOperationStatus =
  | "idle"
  | "validating"
  | "saving-mapping"
  | "fetching-price"
  | "saving-price"
  | "saved"
  | "error";
export type AssetFeedback = {
  status: AssetOperationStatus;
  message: string;
};
export type Translate = ReturnType<typeof useLanguage>["t"];

export type GlobalRefreshState = {
  status: "idle" | "loading" | "saving" | "success" | "partial" | "error";
  message: string;
  failures: BinanceAssetRefreshFailure[];
};
export type GlobalOperation = {
  id: number;
  controller: AbortController;
  ledgerEpoch: number;
  sessionGeneration: number;
  mappingSignature: string;
  expectedPersistedVersion: number | null;
  appliedCount: number;
  failures: BinanceAssetRefreshFailure[];
};
