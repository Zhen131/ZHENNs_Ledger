/**
 * 这个文件放账本存取那个 hook 用到的类型。
 * 具体怎么存、怎么读，在同目录的几个 `usePersistentLedger*.ts` 里。
 * 没有特别的决定。
 */
import type { LedgerData } from "@/core/models";
import { type LedgerCompatibilityWarning } from "@/core/policies";
import { type LedgerImportPolicyError } from "@/core/policies";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerBackupImportEvidence,
  type LedgerSession,
  type LedgerSessionPersistencePort,
  type LedgerRepository,
  type SessionQuiesceRequest,
  type SessionQuiesceToken,
} from "@/platform/persistence";
import type { HydrationStatus } from "./hydrationState";
import { type LedgerAction } from "@/core/state";
import { type LedgerResourcePolicyError } from "@/core/validation";
import { type LedgerTimeSnapshot } from "@/core/shared";

/**
 * 账本存取 hook 交给页面的一整包东西。
 * 里面有当前账本，改账入口，存盘状态，清空和导入，几个开关。
 * 给 `app/dashboard` 和各个工作区页面用。
 */
export type PersistentLedgerState = {
  ledgerData: LedgerData;
  applyLedgerAction: (
    action: LedgerAction,
    timeSnapshot?: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  applyLedgerMutation: (
    mutation: (current: LedgerData) => LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  hydrationStatus: HydrationStatus;
  persistenceError: string | null;
  resourcePolicyError: LedgerResourcePolicyError | null;
  isReadOnly: boolean;
  retryPersistence: () => Promise<boolean>;
  canRetryPersistence: boolean;
  clearLedger: (
    confirmationNonce?: string,
  ) => Promise<ClearLedgerResult>;
  replaceLedgerFromBackup: (
    candidate: unknown,
    timeSnapshot?: LedgerTimeSnapshot,
    evidence?: LedgerBackupImportEvidence,
    signal?: AbortSignal,
  ) => Promise<ImportLedgerResult>;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: PersistenceStatus;
  mutationVersion: number;
  persistedVersion: number;
  isDirty: boolean;
  repositorySwitchBlocked: boolean;
  discardDirtyChangesAndSwitchRepository: () => boolean;
  ledgerEpoch: number;
  compatibilityWarnings: LedgerCompatibilityWarning[];
  isFutureFactCorrectionMode: boolean;
  todayKey: string;
  lifecycleStatus: "active" | "quiescing";
  sessionFatalSignal: LedgerSessionFatalSignal | null;
  drainForSessionQuiesce: (
    request: SessionQuiesceRequest,
  ) => Promise<SessionQuiesceToken>;
};

/**
 * 「导入后恢复被挡住」时发给页面的信号。
 * 带上是哪个会话、第几次，页面据此锁住这本账。
 */
export type LedgerSessionFatalSignal = Readonly<{
  code: "IMPORT_RECOVERY_BLOCKED";
  occurrence: number;
  sessionId: string;
  sessionGeneration: number;
}>;

/** 当前在做的大动作：没有、正在清空、正在导入。 */
export type PersistenceOperation = "idle" | "clearing" | "importing";
/** 存盘状态：没动过、正在存、存好了、存失败。 */
export type PersistenceStatus = "idle" | "saving" | "saved" | "error";
/** 改一笔账的结果：改了、没变化、被拒绝。 */
export type ApplyLedgerActionResult = "applied" | "noop" | "rejected";

/** 改账次数和已存盘次数，再加存盘状态；两个次数相等就是全存好了。 */
export type PersistenceVersionState = {
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
};

/**
 * 排进存盘队的一次存盘。
 * 记着哪一轮、第几次改动、账本文字，和触发它的那张单子。
 */
export type ScheduledSnapshot = {
  generation: number;
  version: number;
  serializedLedger: string | null;
  action?: LedgerAction;
};

/** 正在进行的一次「重试存盘」，同一次改动只许有一个。 */
export type RetryAttempt = {
  generation: number;
  version: number;
  promise: Promise<boolean>;
};

/** 一个会话的存盘通道，连同它手上还没做完的活和停工请求。 */
export type SessionPersistenceBinding = {
  readonly port: LedgerSessionPersistencePort;
  readonly acceptedWork: Set<PromiseLike<unknown>>;
  quiesceRequest: SessionQuiesceRequest | null;
  quiesceDrain: Promise<SessionQuiesceToken> | null;
};

/** 存到哪里：一个仓库，加上它所属的会话（可以没有）。 */
export type PersistenceTarget = Readonly<{
  repository: LedgerRepository;
  session: LedgerSession | undefined;
}>;

/** 一次存盘的结局：存好了、失败了、已经过时不算数。 */
export type PersistenceAttemptResult = "saved" | "failed" | "ignored";
/** 清空账本的结果：成功，或失败并带上清空失败的错误码。 */
export type ClearLedgerResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED;
    };

/** 从备份导入的结果：成功，或失败并带上为什么失败的代码。 */
export type ImportLedgerResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "LEDGER_IMPORT_NOT_ALLOWED"
        | "LEDGER_IMPORT_INVALID_BACKUP"
        | "LEDGER_IMPORT_CANCELLED"
        | "LEDGER_IMPORT_BASE_RESTORED"
        | "LEDGER_IMPORT_SOURCE_CHANGED"
        | "LEDGER_IMPORT_RECOVERY_BLOCKED"
        | typeof LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED;
      errors?: LedgerImportPolicyError[];
    };
