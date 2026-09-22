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

export type LedgerSessionFatalSignal = Readonly<{
  code: "IMPORT_RECOVERY_BLOCKED";
  occurrence: number;
  sessionId: string;
  sessionGeneration: number;
}>;

export type PersistenceOperation = "idle" | "clearing" | "importing";
export type PersistenceStatus = "idle" | "saving" | "saved" | "error";
export type ApplyLedgerActionResult = "applied" | "noop" | "rejected";

export type PersistenceVersionState = {
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
};

export type ScheduledSnapshot = {
  generation: number;
  version: number;
  serializedLedger: string | null;
  action?: LedgerAction;
};

export type RetryAttempt = {
  generation: number;
  version: number;
  promise: Promise<boolean>;
};

export type SessionPersistenceBinding = {
  readonly port: LedgerSessionPersistencePort;
  readonly acceptedWork: Set<PromiseLike<unknown>>;
  quiesceRequest: SessionQuiesceRequest | null;
  quiesceDrain: Promise<SessionQuiesceToken> | null;
};

export type PersistenceTarget = Readonly<{
  repository: LedgerRepository;
  session: LedgerSession | undefined;
}>;

export type PersistenceAttemptResult = "saved" | "failed" | "ignored";
export type ClearLedgerResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED;
    };

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
