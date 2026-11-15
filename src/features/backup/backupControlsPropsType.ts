/**
 * 这个文件只放备份区组件的参数类型，不放会运行的代码。
 * 组件本身在 `BackupControls.tsx`；那个文件行数到顶，类型挪到这里。
 * 不显然的决定：只挪纯类型，内容逐字不变；2026-11-15 定（W26 04B 追加更正第 1 条）。
 */
import type {
  ApplyLedgerActionResult,
  HydrationStatus,
  PersistenceOperation,
} from "@/app";
import type { LedgerData } from "@/core/models";
import type { LedgerClock, LedgerTimeSnapshot } from "@/core/shared";
import type { BinanceMarketDataClient } from "@/platform/integrations";
import type { BackupEnvelopeError } from "./backupEnvelope";
import type { preflightBackupJson } from "./backupImportPreflight";
import type { LedgerBackupImportEvidence } from "./backupImportPreflightResult";

/** 备份区组件收的参数：账本、存盘状态、各种能不能做，和导入入口。 */
export type BackupControlsProps = {
  clock?: LedgerClock;
  ledgerData: LedgerData;
  hydrationStatus: HydrationStatus;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  isReadOnly: boolean;
  isDirty: boolean;
  /**
   * 只管最后那一步写进账本。
   * 它为假时，读好的账本照样能做预检。
   * 这条 2026-07-31 定（W11 03A 第 4.6 节）。
   */
  canImportBackup?: boolean;
  canPreflightBackup?: boolean;
  requiresHistoricalRawText?: boolean;
  ledgerEpoch?: number;
  sessionGeneration?: number;
  mutationVersion?: number;
  persistedVersion?: number;
  isWritable?: boolean;
  applyLedgerMutation?: (
    mutation: (current: LedgerData) => LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  marketDataClient?: BinanceMarketDataClient;
  generateId?: () => string;
  preflight?: typeof preflightBackupJson;
  onImport: (
    candidate: LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
    evidence?: LedgerBackupImportEvidence,
    signal?: AbortSignal,
  ) => Promise<{
    ok: boolean;
    code?: string;
    errors?: BackupEnvelopeError[];
  }>;
  showPlaintextWarning?: boolean;
};
