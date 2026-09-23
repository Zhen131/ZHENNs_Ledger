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

export const LEDGER_REPOSITORY_ERROR_CODES = {
  READ_FAILED: "LEDGER_REPOSITORY_READ_FAILED",
  WRITE_FAILED: "LEDGER_REPOSITORY_WRITE_FAILED",
  CLEAR_FAILED: "LEDGER_REPOSITORY_CLEAR_FAILED",
  INVALID_LEDGER_DATA: "LEDGER_REPOSITORY_INVALID_LEDGER_DATA",
  INVALID_STORED_DATA: "LEDGER_REPOSITORY_INVALID_STORED_DATA",
} as const;

export type LedgerRepositoryErrorCode =
  (typeof LEDGER_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_REPOSITORY_ERROR_CODES];

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
 * 上层唯一的整账持久化入口。
 *
 * load 的 null 明确表示“没有保存数据”；它与已保存的空账本不同。
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

export type LedgerStorageKind = "indexeddb" | "ledger-file";

export type LedgerSessionCapabilities = {
  canClearReadyLedger: boolean;
  canClearHydrationError: boolean;
  canImportBackup: boolean;
};

export type SessionQuiesceReason =
  | "immediate-lock"
  | "route-leave";

export type SessionQuiesceRequest = Readonly<{
  sessionId: string;
  generation: number;
  [sessionQuiesceRequestBrand]: true;
}>;

export type SessionQuiesceToken = Readonly<{
  sessionId: string;
  generation: number;
  [sessionQuiesceTokenBrand]: true;
}>;

export type ReadyLedgerClearAuthorization = Readonly<{
  sessionId: string;
  generation: number;
  fileId: string;
  verifiedRevisionId: string;
  confirmationNonce: string;
  [readyLedgerClearAuthorizationBrand]: true;
}>;

export type ReadyLedgerClearAuthorizationContext = Readonly<{
  sessionId: string;
  generation: number;
  confirmationNonce: string;
}>;

export type ReadyLedgerClearExecutionContext = Readonly<{
  sessionId: string;
  generation: number;
  [readyLedgerClearExecutionContextBrand]: true;
}>;

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

export type ReadyLedgerImportAuthorizationContext =
  LedgerBackupImportEvidence &
    Readonly<{
      sessionId: string;
      generation: number;
      hookGeneration: number;
      candidateIdentity: string;
    }>;

export type ReadyLedgerImportExecutionContext = Readonly<{
  sessionId: string;
  generation: number;
  signal: AbortSignal;
  [readyLedgerImportExecutionContextBrand]: true;
}>;

export type LedgerReadyClearDriver = Readonly<{
  authorizeReadyClear(
    context: ReadyLedgerClearAuthorizationContext,
  ): ReadyLedgerClearAuthorization | null;
  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
    executionContext: ReadyLedgerClearExecutionContext,
  ): Promise<void>;
}>;

export type LedgerReadyClearPort = Readonly<{
  authorizeReadyClear(
    confirmationNonce: string,
  ): ReadyLedgerClearAuthorization | null;
  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
  ): Promise<void>;
}>;

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
 * Hook-owned capability for work that was admitted before quiesce began.
 *
 * This port is deliberately absent from LedgerSession. The public repository
 * façade stops accepting calls synchronously at beginQuiesce(), while the
 * single registered Hook owner can finish its already accepted queue and is
 * the only boundary able to issue the corresponding drain token.
 */
export type LedgerSessionPersistencePort = Readonly<{
  repository: LedgerRepository;
  completeQuiesce(
    request: SessionQuiesceRequest,
    settledWork: PromiseLike<unknown>,
  ): Promise<SessionQuiesceToken>;
}>;

export class LedgerSessionLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerSessionLifecycleError";
  }
}

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

export const INDEXED_DB_LEDGER_CAPABILITIES: LedgerSessionCapabilities = {
  canClearReadyLedger: true,
  canClearHydrationError: true,
  canImportBackup: true,
};

export const LEDGER_FILE_CAPABILITIES: LedgerSessionCapabilities = {
  canClearReadyLedger: true,
  canClearHydrationError: false,
  canImportBackup: false,
};

export const LEDGER_FILE_READY_IMPORT_CAPABILITIES:
  LedgerSessionCapabilities = {
    ...LEDGER_FILE_CAPABILITIES,
    canImportBackup: true,
  };
