import { type BinanceAutoPairSuccess } from "@/features/market-data";
import type { useLanguage } from "@/ui";

export type Translate = ReturnType<typeof useLanguage>["t"];

export type ImportState =
  | "idle"
  | "reading"
  | "preflighting"
  | "preflight-blocked"
  | "ready-without-suspicions"
  | "awaiting-suspicion-confirmation"
  | "awaiting-confirmation"
  | "importing"
  | "success"
  | "write-error";

export type CopyState = "idle" | "copying" | "copied" | "error";

export type PostImportPairingFailure = Readonly<{
  assetSymbol: string;
  code: string;
  message: string;
}>;

export type PostImportPairingState = Readonly<{
  symbols: readonly string[];
  status:
    | "prompt"
    | "validating"
    | "saving-mappings"
    | "fetching-prices"
    | "saving-prices"
    | "success"
    | "partial"
    | "error";
  message: string;
  failures: readonly PostImportPairingFailure[];
}>;

export type PostImportPairingOperation = {
  controller: AbortController;
  ledgerEpoch: number;
  sessionGeneration: number;
  phase:
    | "validating"
    | "saving-mappings"
    | "fetching-prices"
    | "saving-prices";
  expectedPersistedVersion: number | null;
  expectedMappingSignature: string;
  mappingSuccesses: BinanceAutoPairSuccess[];
  mappingFailures: PostImportPairingFailure[];
  appliedMappingSymbols: string[];
  appliedPriceCount: number;
  priceFailures: PostImportPairingFailure[];
};
