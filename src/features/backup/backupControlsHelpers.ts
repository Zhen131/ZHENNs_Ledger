/**
 * 这个文件放备份区的三个小函数。
 * 整理配对失败、判断忙不忙、查确认还有效没有。
 * 用它们的是 `BackupControls.tsx` 和 `backupControlsPairing.ts`。
 * 没有特别的决定。
 */
import { isBackupImportSuspicionConfirmationValid } from "./backupImportPreflightReceipts";
import {
  type BackupImportPreflightResult,
  type BackupSuspicionConfirmationReceipt,
} from "./backupImportPreflightResult";
import { type BinanceAutoPairFailure } from "@/features/market-data";
import type {
  PostImportPairingFailure,
  PostImportPairingState,
} from "./backupControlsTypes";
import type { Translate } from "@/ui";

/**
 * 这个函数把一条币安配对失败整理成界面上的一条。
 * 「当前无法验证」这种失败换成固定的一句说明。
 * 为什么这样：拿不到可读回复时，不能随便断定原因；2026-08-19 定（W14 01B 第 5.4 节）。
 */
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

/**
 * 这个函数回答：导入后的配对现在是不是正在跑？
 * 验证、存映射、取价格、存价格这四步都算在跑。
 */
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

/**
 * 这个函数回答：这次预检的疑似重复确认现在还有效吗？
 * 交给 `isBackupImportSuspicionConfirmationValid` 去判。
 */
export function hasCurrentSuspicionConfirmation(
  result: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null = null,
): boolean {
  return isBackupImportSuspicionConfirmationValid(
    result,
    confirmation,
  );
}
