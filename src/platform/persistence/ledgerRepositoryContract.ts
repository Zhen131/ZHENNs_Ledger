/**
 * 这个文件管存取账本这一层对外约定的形状。
 * 包括能做什么、出错长什么样。
 * 它不管具体怎么存，那在 ledgerRepository.ts 和 files 区。
 * 不显然的决定：存取入口只留一个，上层不直接碰文件。这是猜的，日志里没写，要核。
 */

import { type LedgerBackupImportEvidence } from "@/features/backup";
import type { LedgerData } from "@/core/models";
import type { LedgerAction } from "@/core/state";
import {
  readyLedgerClearAuthorizationBrand,
  readyLedgerClearExecutionContextBrand,
  readyLedgerImportAuthorizationBrand,
  readyLedgerImportExecutionContextBrand,
  sessionQuiesceRequestBrand,
  sessionQuiesceTokenBrand,
} from "./ledgerRepositoryBrands";

/**
 * 存取账本时可能报的错误代码。
 * 有读失败、写失败、清空失败。
 * 还有账本不合法、存着的东西不合法。
 */
export const LEDGER_REPOSITORY_ERROR_CODES = {
  READ_FAILED: "LEDGER_REPOSITORY_READ_FAILED",
  WRITE_FAILED: "LEDGER_REPOSITORY_WRITE_FAILED",
  CLEAR_FAILED: "LEDGER_REPOSITORY_CLEAR_FAILED",
  INVALID_LEDGER_DATA: "LEDGER_REPOSITORY_INVALID_LEDGER_DATA",
  INVALID_STORED_DATA: "LEDGER_REPOSITORY_INVALID_STORED_DATA",
} as const;

type LedgerRepositoryErrorCode =
  (typeof LEDGER_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_REPOSITORY_ERROR_CODES];

/**
 * 这个类是存取账本出错时抛的错。
 * 带着上面那张表里的错误代码。
 */
export class LedgerRepositoryError extends Error {
  readonly code: LedgerRepositoryErrorCode;
  readonly cause?: unknown;

  constructor(
    code: LedgerRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerRepositoryError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 上层存取整本账本的唯一入口。
 * 包括读、存、改完一单后存、清空。
 * 读到 null 表示「没有存过」，和「存过一本空账本」不一样。
 */
export interface LedgerRepository {
  load(): Promise<LedgerData | null>;
  save(ledgerData: LedgerData): Promise<void>;
  saveAfterAction?(
    action: LedgerAction,
    ledgerData: LedgerData,
  ): Promise<void>;
  clear(): Promise<void>;
}

/** 账本存在哪种地方。现在只有账本文件这一种。 */
export type LedgerStorageKind = "ledger-file";

/**
 * 这次打开的账本能做哪几件事。
 * 包括清空、出错时清空、导入备份。
 */
export type LedgerSessionCapabilities = {
  canClearReadyLedger: boolean;
  canClearHydrationError: boolean;
  canImportBackup: boolean;
};

/** 为什么要停止接新活：马上锁上，或离开页面。 */
export type SessionQuiesceReason =
  | "immediate-lock"
  | "route-leave";

/** 一张「停止接新活」的请求，写着是哪次打开、第几次。 */
export type SessionQuiesceRequest = Readonly<{
  sessionId: string;
  generation: number;
  [sessionQuiesceRequestBrand]: true;
}>;

/** 一张「活都做完了」的凭证，写着是哪次打开、第几次。 */
export type SessionQuiesceToken = Readonly<{
  sessionId: string;
  generation: number;
  [sessionQuiesceTokenBrand]: true;
}>;

/**
 * 清空当前账本的授权。
 * 包括哪次打开、哪个文件、哪个版本、确认的那句话。
 */
export type ReadyLedgerClearAuthorization = Readonly<{
  sessionId: string;
  generation: number;
  fileId: string;
  verifiedRevisionId: string;
  confirmationNonce: string;
  [readyLedgerClearAuthorizationBrand]: true;
}>;

/**
 * 申请清空授权时一起传进来的那些条件。
 * 包括哪次打开、第几次、确认的那句话。
 */
export type ReadyLedgerClearAuthorizationContext = Readonly<{
  sessionId: string;
  generation: number;
  confirmationNonce: string;
}>;

/** 真正执行清空时的凭证：哪次打开、第几次。只能用一次。 */
export type ReadyLedgerClearExecutionContext = Readonly<{
  sessionId: string;
  generation: number;
  [readyLedgerClearExecutionContextBrand]: true;
}>;

/**
 * 导入替换当前账本的授权。
 * 写着当时看到的文件、版本和导入内容的指纹。
 */
export type ReadyLedgerImportAuthorization = Readonly<{
  sessionId: string;
  generation: number;
  hookGeneration: number;
  fileId: string;
  verifiedRevisionId: string;
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  suspiciousGroupIdentity: string;
  requireHistoricalRawText: boolean;
  [readyLedgerImportAuthorizationBrand]: true;
}>;

/**
 * 申请导入授权时一起传进来的那些条件。
 * 备份的检查结果和这次打开的编号。
 */
export type ReadyLedgerImportAuthorizationContext =
  LedgerBackupImportEvidence &
    Readonly<{
      sessionId: string;
      generation: number;
      hookGeneration: number;
      candidateIdentity: string;
    }>;

/** 真正执行导入时的凭证：哪次打开、第几次、取消信号。只能用一次。 */
export type ReadyLedgerImportExecutionContext = Readonly<{
  sessionId: string;
  generation: number;
  signal: AbortSignal;
  [readyLedgerImportExecutionContextBrand]: true;
}>;

/**
 * 真正做清空的那一方要提供的两件事。
 * 包括发授权、按授权清空。
 */
export type LedgerReadyClearDriver = Readonly<{
  authorizeReadyClear(
    context: ReadyLedgerClearAuthorizationContext,
  ): ReadyLedgerClearAuthorization | null;
  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
    executionContext: ReadyLedgerClearExecutionContext,
  ): Promise<void>;
}>;

/** 界面能拿到的清空入口：先拿授权，再按授权清空。 */
export type LedgerReadyClearPort = Readonly<{
  authorizeReadyClear(
    confirmationNonce: string,
  ): ReadyLedgerClearAuthorization | null;
  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
  ): Promise<void>;
}>;

/**
 * 真正做导入的那一方要提供的两件事。
 * 包括发授权、按授权导入。
 */
export type LedgerReadyImportDriver = Readonly<{
  authorizeReadyImport(
    context: ReadyLedgerImportAuthorizationContext,
  ): ReadyLedgerImportAuthorization | null;
  importReadyLedger(
    authorization: ReadyLedgerImportAuthorization,
    candidate: LedgerData,
    executionContext: ReadyLedgerImportExecutionContext,
  ): Promise<LedgerData>;
}>;

/** 界面能拿到的导入入口：先拿授权，再按授权导入。 */
export type LedgerReadyImportPort = Readonly<{
  authorizeReadyImport(
    evidence: LedgerBackupImportEvidence,
    hookGeneration: number,
    candidateIdentity: string,
  ): ReadyLedgerImportAuthorization | null;
  importReadyLedger(
    authorization: ReadyLedgerImportAuthorization,
    candidate: LedgerData,
    signal: AbortSignal,
  ): Promise<LedgerData>;
}>;

/**
 * 一次打开的账本：存取入口、能做的事、清空和导入入口。
 * 以及停止接新活、锁上、放开。
 */
export type LedgerSession = Readonly<{
  sessionId: string;
  generation: number;
  storageKind: LedgerStorageKind;
  repository: LedgerRepository;
  capabilities: LedgerSessionCapabilities;
  readyClearPort: LedgerReadyClearPort | null;
  readyImportPort: LedgerReadyImportPort | null;
  beginQuiesce(reason: SessionQuiesceReason): SessionQuiesceRequest;
  lockAfterQuiesce(token: SessionQuiesceToken): Promise<void>;
  releaseAfterQuiesce(token: SessionQuiesceToken): Promise<void>;
}>;

/**
 * 只给负责存盘的那个 hook 用的入口，不放在 LedgerSession 里。
 * 一开始停止接新活，对外的存取入口马上不再收活。
 * 但停之前已经收下的活，这个 hook 还能做完。
 * 只有它能发「活都做完了」的凭证。
 */
export type LedgerSessionPersistencePort = Readonly<{
  repository: LedgerRepository;
  completeQuiesce(
    request: SessionQuiesceRequest,
    settledWork: PromiseLike<unknown>,
  ): Promise<SessionQuiesceToken>;
}>;

/** 这个类是账本开关步骤顺序不对时抛的错。 */
export class LedgerSessionLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerSessionLifecycleError";
  }
}

/**
 * 新开一次账本时要给的东西。
 * 包括存取入口、能做的事、清空和导入的执行方等。
 */
export type CreateLedgerSessionOptions = {
  storageKind: LedgerStorageKind;
  repository: LedgerRepository;
  capabilities: LedgerSessionCapabilities;
  readyClearDriver?: LedgerReadyClearDriver;
  readyImportDriver?: LedgerReadyImportDriver;
  onBeginQuiesce?: () => void;
  release?: () => Promise<void>;
  createSessionId?: () => string;
};

/**
 * 用账本文件时默认能做的事。
 * 能清空当前账本，不能清出错的，不能导入备份。
 */
export const LEDGER_FILE_CAPABILITIES: LedgerSessionCapabilities = {
  canClearReadyLedger: true,
  canClearHydrationError: false,
  canImportBackup: false,
};

/** 用账本文件、并且允许导入备份时能做的事。 */
export const LEDGER_FILE_READY_IMPORT_CAPABILITIES:
  LedgerSessionCapabilities = {
    ...LEDGER_FILE_CAPABILITIES,
    canImportBackup: true,
  };
