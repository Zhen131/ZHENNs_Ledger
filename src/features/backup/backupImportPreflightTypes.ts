/**
 * 这个文件放导入预检结果里用到的几个小类型。
 * 预检怎么做在 `backupImportPreflight.ts`，整份结果的类型在 `backupImportPreflightResult.ts`。
 * 没有特别的决定。
 */
import { type SuspiciousBackupTradeGroup } from "./backupDuplicateGrouping";

/**
 * 一个 B 文件内容的身份：SHA-256 摘要和字节数。
 * 内容改一个字，身份就变。
 */
export type BackupContentIdentity = Readonly<{
  sha256: string;
  utf8ByteLength: number;
  value: string;
}>;

/**
 * 一笔交易的简短样子，给报告里看。
 * 有日期、币、买卖、数量、单价、金额。
 * 读不到的栏就空着。
 */
export type BackupTradeSummary = Readonly<{
  occurredAt?: string;
  assetSymbol?: string;
  type?: "buy" | "sell";
  quantity?: string;
  price?: string;
  totalValue?: string;
  currency?: string;
}>;

/**
 * 一条硬错误：有它就不许导入。
 * 带检查阶段、代码、出错位置、说明。
 * 能取到时还带交易简样和行列号。
 */
export type BackupPreflightHardError = Readonly<{
  kind: "hard-error";
  stage: number;
  code: string;
  path: string;
  message: string;
  summary?: BackupTradeSummary;
  line?: number;
  column?: number;
  limit?: number;
  actual?: number;
}>;

/**
 * 一组疑似重复交易在报告里的样子。
 * 有这一组、每笔的简样、一句说明。
 */
export type BackupPreflightSuspiciousDetail = Readonly<{
  kind: "suspicious-group";
  group: SuspiciousBackupTradeGroup;
  summaries: readonly BackupTradeSummary[];
  message: string;
}>;

/**
 * 一项因为前面出错而没做的检查，以及没做的原因。
 * 没做的不算通过。
 */
export type BackupPreflightSkippedCheck = Readonly<{
  check:
    | "json-parse"
    | "backup-envelope"
    | "ledger-structure"
    | "resource-policy"
    | "import-policy"
    | "duplicate-grouping";
  reason: string;
}>;

/**
 * B 文件的基本情况：文件名、各版本号、导出时刻。
 * 还有各类记录多少条。
 * 能算出来时，还带现金余额、缺口和没配币安对的币。
 */
export type BackupPreflightMetadata = Readonly<{
  sourceFileName?: string;
  backupFormatVersion?: number;
  appVersion?: string;
  exportedAt?: string;
  ledgerSchemaVersion?: number;
  assetCount?: number;
  tradeCount?: number;
  cashEventCount?: number;
  assetTransferCount?: number;
  priceSnapshotCount?: number;
  feeRuleCount?: number;
  cashBalance?: string;
  cashDeficit?: string;
  missingMappingSymbols?: readonly string[];
}>;

/**
 * 一条提醒：不挡导入，只让人看见。
 * 现在只有一种：导入后现金会是负数。
 */
export type BackupPreflightWarning = Readonly<{
  code: "BACKUP_NEGATIVE_CASH_BALANCE";
  message: string;
}>;
