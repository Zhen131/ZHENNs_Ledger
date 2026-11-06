/**
 * 这个文件放行情区几处共用的类型。
 * 管单个币的操作、提示、全局刷新。
 * 用它们的是 `MarketDataControls.tsx` 和旁边几个 `marketDataControls*.ts`。
 * 没有特别的决定。
 */
import type { BinanceMarketMapping } from "@/core/models";
import { type BinanceAssetRefreshFailure } from "./binancePriceRefreshService";

/** 单个币的两种操作：保存交易对，或刷新价格。 */
export type AssetOperationKind = "save-mapping" | "refresh-price";
type AssetOperationPhase =
  | "validating"
  | "saving-mapping"
  | "fetching-price"
  | "saving-price";
/**
 * 正在进行的一次单币操作，可以取消。
 * 记着第几次、做什么、走到哪步。
 * 还记着当时是哪本账本、第几次打开。
 * 以及对应关系的样子、等哪个版本存盘。
 */
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
/** 单个币旁边显示的提示：走到哪一步，和一句话。 */
export type AssetFeedback = {
  status: AssetOperationStatus;
  message: string;
};

/** 「刷新手里的币」那个按钮的状态、提示和失败清单。 */
export type GlobalRefreshState = {
  status: "idle" | "loading" | "saving" | "success" | "partial" | "error";
  message: string;
  failures: BinanceAssetRefreshFailure[];
};
/**
 * 正在进行的一次全局刷新，可以取消。
 * 记着当时的账本和对应关系。
 * 还记着等哪个版本存盘、合进了几条、哪些失败。
 */
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
