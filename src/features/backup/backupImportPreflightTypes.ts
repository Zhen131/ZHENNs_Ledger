import { type SuspiciousBackupTradeGroup } from "./backupDuplicateGrouping";

export type BackupContentIdentity = Readonly<{
  sha256: string;
  utf8ByteLength: number;
  value: string;
}>;

export type BackupTradeSummary = Readonly<{
  occurredAt?: string;
  assetSymbol?: string;
  type?: "buy" | "sell";
  quantity?: string;
  price?: string;
  totalValue?: string;
  currency?: string;
}>;

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

export type BackupPreflightSuspiciousDetail = Readonly<{
  kind: "suspicious-group";
  group: SuspiciousBackupTradeGroup;
  summaries: readonly BackupTradeSummary[];
  message: string;
}>;

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

export type BackupPreflightWarning = Readonly<{
  code: "BACKUP_NEGATIVE_CASH_BALANCE";
  message: string;
}>;
