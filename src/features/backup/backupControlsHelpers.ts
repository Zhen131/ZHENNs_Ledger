import {
  isBackupImportSuspicionConfirmationValid,
  type BackupImportPreflightResult,
  type BackupSuspicionConfirmationReceipt,
} from "./backupImportPreflight";
import { type BinanceAutoPairFailure } from "@/features/market-data";
import type {
  Translate,
  PostImportPairingFailure,
  PostImportPairingState,
} from "./backupControlsTypes";

export function normalizePairingFailure(
  failure: BinanceAutoPairFailure,
  t: Translate,
): PostImportPairingFailure {
  return {
    assetSymbol: failure.assetSymbol,
    code: failure.code,
    message:
      failure.code === "BINANCE_VALIDATION_UNAVAILABLE"
        ? t("marketData.failure.validationUnavailable")
        : failure.message,
  };
}

export function isPostImportPairingBusy(
  status: PostImportPairingState["status"],
): boolean {
  return (
    status === "validating" ||
    status === "saving-mappings" ||
    status === "fetching-prices" ||
    status === "saving-prices"
  );
}

export function hasCurrentSuspicionConfirmation(
  result: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null = null,
): boolean {
  return isBackupImportSuspicionConfirmationValid(
    result,
    confirmation,
  );
}
