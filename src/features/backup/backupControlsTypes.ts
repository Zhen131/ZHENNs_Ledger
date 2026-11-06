/**
 * 这个文件放备份区几处共用的类型。
 * 管导入走到哪一步、复制报告、导入后配对。
 * 用它们的是 `BackupControls.tsx` 和旁边几个 `backupControls*.ts`。
 * 没有特别的决定。
 */
import { type BinanceAutoPairSuccess } from "@/features/market-data";
import type { LedgerData } from "@/core/models";
import type { LedgerTimeSnapshot } from "@/core/shared";
import type { ApplyLedgerActionResult } from "@/app";


/**
 * 导入 B 文件走到哪一步了。
 * 从读文件、预检、等确认，到正在导入、成功或写入出错。
 */
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

/**
 * 复制预检报告的状态。
 * 没复制、正在复制、复制好了、复制失败。
 */
export type CopyState = "idle" | "copying" | "copied" | "error";

/** 导入后配币安对时，一种币失败了：哪种币、失败代码、说明。 */
export type PostImportPairingFailure = Readonly<{
  assetSymbol: string;
  code: string;
  message: string;
}>;

/**
 * 导入后「联网配币安对」那一块的状态。
 * 有要配哪些币、走到哪步、说明、失败清单。
 */
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

/**
 * 正在进行的那一次配对，可以中途取消。
 * 它记着当时是哪本账本、第几次打开。
 * 还记着已配上几个、价格存了几条、哪些失败了。
 */
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

/**
 * `BackupControls` 收到的「改账本」那个函数的样子。
 * 这里去掉了它可以不传的情况。
 */
export type ApplyLedgerMutation = (
  mutation: (current: LedgerData) => LedgerData,
  timeSnapshot?: LedgerTimeSnapshot,
) => ApplyLedgerActionResult;
