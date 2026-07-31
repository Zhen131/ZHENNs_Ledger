import {
  LedgerFileAdapterError,
  type LedgerFileHandle,
  type LedgerFileHandleAdapter,
} from "../adapters/ledgerFileHandleAdapter";
import {
  LedgerFileConnectionRecordError,
  type LedgerFileConnectionAdapter,
  type LedgerFileConnectionRecordV1,
} from "../adapters/ledgerFileConnectionAdapter";
import {
  DefaultLedgerFileSessionCoordinator,
  type LedgerFileSessionCoordinator,
  type LedgerFileSessionLease,
} from "../coordination/ledgerFileSessionCoordinator";
import { validatePassphrase } from "../encryption/passphrasePolicy";
import type { LedgerData } from "../models";
import {
  claimLedgerSessionPersistencePort,
  createLedgerSession,
  LEDGER_FILE_READY_IMPORT_CAPABILITIES,
  type LedgerSession,
  type LedgerSessionPersistencePort,
  type SessionQuiesceToken,
} from "../repositories/ledgerRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepository,
  LedgerFileRepositoryError,
  type LedgerFileRecoveryCandidate,
  inspectLedgerFile,
  type LedgerFileRepositoryDependencies,
} from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";

export const LEDGER_FILE_ACCESS_ERROR_CODES = {
  CANCELLED: "LEDGER_FILE_ACCESS_CANCELLED",
  PICKER_UNAVAILABLE: "LEDGER_FILE_PICKER_UNAVAILABLE",
  INVALID_EXTENSION: "LEDGER_FILE_INVALID_EXTENSION",
  NON_EMPTY_CREATE_TARGET: "LEDGER_FILE_NON_EMPTY_CREATE_TARGET",
  INVALID_FILE: "LEDGER_FILE_ACCESS_INVALID_FILE",
  CREATE_FAILED: "LEDGER_FILE_ACCESS_CREATE_FAILED",
  UNLOCK_FAILED: "LEDGER_FILE_ACCESS_UNLOCK_FAILED",
  NO_SELECTION: "LEDGER_FILE_ACCESS_NO_SELECTION",
  FILE_IN_USE: "LEDGER_FILE_ACCESS_FILE_IN_USE",
  COORDINATION_UNSUPPORTED:
    "LEDGER_FILE_ACCESS_COORDINATION_UNSUPPORTED",
  COORDINATION_FAILED: "LEDGER_FILE_ACCESS_COORDINATION_FAILED",
  RECOVERY_NOT_FOUND: "LEDGER_FILE_ACCESS_RECOVERY_NOT_FOUND",
  RECOVERY_FAILED: "LEDGER_FILE_ACCESS_RECOVERY_FAILED",
  EXTERNAL_CHANGE: "LEDGER_FILE_ACCESS_EXTERNAL_CHANGE",
  CONNECTION_INVALID: "LEDGER_FILE_ACCESS_CONNECTION_INVALID",
  CONNECTION_SAVE_FAILED:
    "LEDGER_FILE_ACCESS_CONNECTION_SAVE_FAILED",
  PERMISSION_DENIED: "LEDGER_FILE_ACCESS_PERMISSION_DENIED",
  PERMISSION_REQUIRED: "LEDGER_FILE_ACCESS_PERMISSION_REQUIRED",
  RECONNECT_FAILED: "LEDGER_FILE_ACCESS_RECONNECT_FAILED",
  WRONG_RECONNECT_FILE: "LEDGER_FILE_ACCESS_WRONG_RECONNECT_FILE",
} as const;

export type LedgerFileAccessErrorCode =
  (typeof LEDGER_FILE_ACCESS_ERROR_CODES)[keyof typeof LEDGER_FILE_ACCESS_ERROR_CODES];

export type LedgerFileAccessSessionResult =
  | { status: "unlocked"; ok: true; session: LedgerSession }
  | {
      status: "recovery-required";
      ok: false;
      recoveryId: string;
    }
  | {
      status: "error";
      ok: false;
      code: LedgerFileAccessErrorCode;
    };

export type LedgerFileSelectionResult =
  | { ok: true }
  | { ok: false; code: LedgerFileAccessErrorCode };

export type LedgerFileReconnectResult =
  | { status: "none"; ok: true }
  | { status: "ready"; ok: true }
  | { status: "permission-prompt"; ok: false }
  | {
      status: "error";
      ok: false;
      code: LedgerFileAccessErrorCode;
    };

const ledgerFileMigrationReceiptBrand = Symbol(
  "ledger-file-migration-receipt",
);

export type LedgerFileMigrationReceipt = Readonly<{
  sessionId: string;
  generation: number;
  fileId: string;
  verifiedRevisionId: string;
  serializedLedgerData: string;
  [ledgerFileMigrationReceiptBrand]: true;
}>;

export interface LedgerFileAccessController {
  inspectRememberedConnection(): Promise<LedgerFileReconnectResult>;
  requestRememberedPermission(): Promise<LedgerFileReconnectResult>;
  reselectRememberedConnection(): Promise<LedgerFileSelectionResult>;
  forgetRememberedConnection(): Promise<void>;
  create(passphrase: string): Promise<LedgerFileAccessSessionResult>;
  createFromLegacy?(
    passphrase: string,
    ledgerData: LedgerData,
  ): Promise<LedgerFileAccessSessionResult>;
  verifyMigrationTarget?(
    session: LedgerSession,
    expectedLedgerData: LedgerData,
  ): Promise<LedgerFileMigrationReceipt | null>;
  revalidateMigrationReceipt?(
    receipt: LedgerFileMigrationReceipt,
  ): Promise<boolean>;
  releaseUnpublishedMigrationSession?(
    session: LedgerSession,
  ): Promise<void>;
  selectExisting(): Promise<LedgerFileSelectionResult>;
  unlockSelected(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult>;
  confirmRecovery(
    recoveryId: string,
  ): Promise<LedgerFileAccessSessionResult>;
  cancelRecovery(recoveryId: string): Promise<void>;
  cancelPendingSelection(): void;
}

type PendingSelection = {
  handle: LedgerFileHandle;
  fileId: string;
  connectionRecord: LedgerFileConnectionRecordV1;
};

type PendingRecovery = {
  recoveryId: string;
  candidate: LedgerFileRecoveryCandidate;
  lease: LedgerFileSessionLease;
  operation: number;
  confirmation: Promise<LedgerFileAccessSessionResult> | null;
  cancelRequested: boolean;
  cancellation: Promise<void> | null;
  connectionRecord: LedgerFileConnectionRecordV1;
};

type ActiveLedgerFileSession = {
  session: LedgerSession;
  repository: LedgerFileRepository;
  lease: LedgerFileSessionLease;
  releaseAttempt: Promise<void> | null;
};

type RetainedLeaseCleanup = {
  lease: LedgerFileSessionLease;
  releaseAttempt: Promise<void> | null;
};

class LedgerFileConnectionCommitError extends Error {
  constructor(readonly cause: unknown) {
    super("Could not save the verified ledger file connection");
    this.name = "LedgerFileConnectionCommitError";
  }
}

type LedgerFileMigrationReceiptRuntime = {
  readonly controller: DefaultLedgerFileAccessController;
  readonly session: LedgerSession;
  readonly repository: LedgerFileRepository;
  readonly receipt: LedgerFileMigrationReceipt;
};

const ledgerFileMigrationReceiptRuntimes = new WeakMap<
  LedgerFileMigrationReceipt,
  LedgerFileMigrationReceiptRuntime
>();
type UnpublishedMigrationReleaseRuntime = {
  readonly controller: DefaultLedgerFileAccessController;
  readonly session: LedgerSession;
  readonly owner: object;
  readonly port: LedgerSessionPersistencePort;
  tokenPromise: Promise<SessionQuiesceToken> | null;
};
const unpublishedMigrationReleaseRuntimes = new WeakMap<
  LedgerSession,
  UnpublishedMigrationReleaseRuntime
>();

export function revalidateLedgerFileMigrationReceipt(
  receipt: LedgerFileMigrationReceipt,
): Promise<boolean> {
  const runtime = ledgerFileMigrationReceiptRuntimes.get(receipt);
  return runtime
    ? runtime.controller.revalidateMigrationReceipt(receipt)
    : Promise.resolve(false);
}

export class DefaultLedgerFileAccessController
  implements LedgerFileAccessController
{
  private pendingSelection: PendingSelection | null = null;
  private pendingRecovery: PendingRecovery | null = null;
  private activeSession: ActiveLedgerFileSession | null = null;
  private readonly retainedLeaseCleanups = new Map<
    LedgerFileSessionLease,
    RetainedLeaseCleanup
  >();
  private operationGeneration = 0;
  private operationAbortController = new AbortController();
  private rememberedConnection: LedgerFileConnectionRecordV1 | null =
    null;

  constructor(
    private readonly adapter: LedgerFileHandleAdapter,
    private readonly dependencies: LedgerFileRepositoryDependencies = {},
    private readonly coordinator: LedgerFileSessionCoordinator =
      new DefaultLedgerFileSessionCoordinator(),
    private readonly createRecoveryId: () => string =
      defaultCreateRecoveryId,
    private readonly connectionAdapter?: LedgerFileConnectionAdapter,
  ) {}

  async inspectRememberedConnection(): Promise<LedgerFileReconnectResult> {
    if (!this.connectionAdapter) {
      return { status: "none", ok: true };
    }
    if (this.hasOwnedFileSession()) {
      return reconnectError(
        LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      );
    }
    const operation = this.beginOperation();
    try {
      const record = await this.connectionAdapter.read(
        this.operationSignal(operation),
      );
      if (!this.isCurrentOperation(operation)) {
        return reconnectError(LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED);
      }
      this.rememberedConnection = record;
      if (!record) {
        return { status: "none", ok: true };
      }
      const permission = await this.adapter.queryPermission(
        record.handle,
        "readwrite",
      );
      if (!this.isCurrentOperation(operation)) {
        return reconnectError(LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED);
      }
      if (permission === "prompt") {
        return { status: "permission-prompt", ok: false };
      }
      if (permission === "denied") {
        return reconnectError(
          LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED,
        );
      }
      return await this.prepareRememberedSelection(record, operation);
    } catch (error) {
      if (!this.isCurrentOperation(operation)) {
        return reconnectError(LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED);
      }
      this.pendingSelection = null;
      return reconnectError(mapReconnectError(error));
    }
  }

  async requestRememberedPermission(): Promise<LedgerFileReconnectResult> {
    const record = this.rememberedConnection;
    if (!record) {
      return reconnectError(
        LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED,
      );
    }
    if (this.hasOwnedFileSession()) {
      return reconnectError(
        LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      );
    }
    const operation = this.beginOperation();
    try {
      const permission = await this.adapter.requestPermission(
        record.handle,
        "readwrite",
      );
      if (!this.isCurrentOperation(operation)) {
        return reconnectError(LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED);
      }
      if (permission !== "granted") {
        return reconnectError(
          permission === "denied"
            ? LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED
            : LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_REQUIRED,
        );
      }
      return await this.prepareRememberedSelection(record, operation);
    } catch (error) {
      if (!this.isCurrentOperation(operation)) {
        return reconnectError(LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED);
      }
      this.pendingSelection = null;
      return reconnectError(mapReconnectError(error));
    }
  }

  async reselectRememberedConnection(): Promise<LedgerFileSelectionResult> {
    const record = this.rememberedConnection;
    if (!record) {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED,
      };
    }
    if (this.hasOwnedFileSession()) {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      };
    }
    const operation = this.beginOperation();
    try {
      const picked = await this.adapter.pickExistingLedgerFile();
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      if (picked.status === "cancelled") {
        return {
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
        };
      }
      const sameEntry = await record.handle.isSameEntry(picked.handle);
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      if (!sameEntry) {
        return {
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE,
        };
      }
      let permission = await this.adapter.queryPermission(
        picked.handle,
        "readwrite",
      );
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      if (permission === "prompt") {
        permission = await this.adapter.requestPermission(
          picked.handle,
          "readwrite",
        );
        if (!this.isCurrentOperation(operation)) {
          return staleSelectionResult();
        }
      }
      if (permission !== "granted") {
        return {
          ok: false,
          code:
            permission === "denied"
              ? LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED
              : LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_REQUIRED,
        };
      }
      const prepared = await this.prepareRememberedSelection(
        {
          connectionFormatVersion: 1,
          handle: picked.handle,
          expectedFileId: record.expectedFileId,
        },
        operation,
      );
      return prepared.status === "ready"
        ? { ok: true }
        : {
            ok: false,
            code:
              prepared.status === "error"
                ? prepared.code
                : LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED,
          };
    } catch (error) {
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      this.pendingSelection = null;
      return {
        ok: false,
        code: mapReconnectError(error),
      };
    }
  }

  async forgetRememberedConnection(): Promise<void> {
    if (this.hasOwnedFileSession()) {
      throw new Error("Cannot forget an active ledger file connection");
    }
    const operation = this.beginOperation();
    if (this.connectionAdapter) {
      await this.connectionAdapter.clear(
        this.operationSignal(operation),
      );
    }
    if (!this.isCurrentOperation(operation)) {
      return;
    }
    this.rememberedConnection = null;
    this.pendingSelection = null;
  }

  async create(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult> {
    return this.createWithInitialLedger(
      passphrase,
      createInitialLedgerData(),
    );
  }

  async createFromLegacy(
    passphrase: string,
    ledgerData: LedgerData,
  ): Promise<LedgerFileAccessSessionResult> {
    return this.createWithInitialLedger(passphrase, ledgerData);
  }

  async verifyMigrationTarget(
    session: LedgerSession,
    expectedLedgerData: LedgerData,
  ): Promise<LedgerFileMigrationReceipt | null> {
    const active = this.activeSession;
    if (
      !active ||
      active.session !== session ||
      session.generation !== 0
    ) {
      return null;
    }
    const loaded = await active.repository.load();
    const serializedLedgerData = JSON.stringify(loaded);
    if (serializedLedgerData !== JSON.stringify(expectedLedgerData)) {
      return null;
    }
    await active.repository.verifyCurrentDiskState();
    const receipt: LedgerFileMigrationReceipt = Object.freeze({
      sessionId: session.sessionId,
      generation: session.generation,
      fileId: active.repository.getVerifiedFileId(),
      verifiedRevisionId:
        active.repository.getVerifiedRevisionId(),
      serializedLedgerData,
      [ledgerFileMigrationReceiptBrand]: true as const,
    });
    ledgerFileMigrationReceiptRuntimes.set(receipt, {
      controller: this,
      session,
      repository: active.repository,
      receipt,
    });
    return receipt;
  }

  async revalidateMigrationReceipt(
    receipt: LedgerFileMigrationReceipt,
  ): Promise<boolean> {
    const runtime = ledgerFileMigrationReceiptRuntimes.get(receipt);
    const active = this.activeSession;
    if (
      !runtime ||
      runtime.controller !== this ||
      runtime.receipt !== receipt ||
      !active ||
      active.session !== runtime.session ||
      active.repository !== runtime.repository ||
      receipt.sessionId !== runtime.session.sessionId ||
      receipt.generation !== runtime.session.generation ||
      receipt.fileId !== runtime.repository.getVerifiedFileId() ||
      receipt.verifiedRevisionId !==
        runtime.repository.getVerifiedRevisionId()
    ) {
      return false;
    }
    try {
      await runtime.repository.verifyCurrentDiskState();
      const loaded = await runtime.repository.load();
      return JSON.stringify(loaded) === receipt.serializedLedgerData;
    } catch {
      return false;
    }
  }

  async releaseUnpublishedMigrationSession(
    session: LedgerSession,
  ): Promise<void> {
    let runtime = unpublishedMigrationReleaseRuntimes.get(session);
    if (runtime && runtime.controller !== this) {
      throw new Error(
        "Migration session belongs to another file controller",
      );
    }
    if (!runtime) {
      if (this.activeSession?.session !== session) {
        return;
      }
      const owner = {};
      const port = claimLedgerSessionPersistencePort(
        session,
        owner,
      );
      runtime = {
        controller: this,
        session,
        owner,
        port,
        tokenPromise: null,
      };
      unpublishedMigrationReleaseRuntimes.set(session, runtime);
    }
    if (!runtime.tokenPromise) {
      const request = session.beginQuiesce("route-leave");
      runtime.tokenPromise = runtime.port.completeQuiesce(
        request,
        Promise.resolve(),
      );
    }
    const token = await runtime.tokenPromise;
    await session.releaseAfterQuiesce(token);
    unpublishedMigrationReleaseRuntimes.delete(session);
  }

  private async createWithInitialLedger(
    passphrase: string,
    initialLedgerData: LedgerData,
  ): Promise<LedgerFileAccessSessionResult> {
    if (this.hasOwnedFileSession()) {
      return ownedFileSessionResult();
    }
    const operation = this.beginOperation();
    if (!validatePassphrase(passphrase).ok) {
      return {
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED,
      };
    }

    let lease: LedgerFileSessionLease | null = null;
    try {
      const picked = await this.adapter.pickNewLedgerFile();
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      if (picked.status === "cancelled") {
        return {
          status: "error",
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
        };
      }

      const acquired = await this.coordinator.acquire(picked.handle);
      if (!this.isCurrentOperation(operation)) {
        if (acquired.status === "acquired") {
          await this.bestEffortRetainedRelease(acquired.lease);
        }
        return staleOperationResult();
      }
      if (acquired.status !== "acquired") {
        return coordinationFailureResult(acquired.status);
      }
      lease = acquired.lease;
      const repository = await LedgerFileRepository.create(
        this.adapter,
        picked.handle,
        passphrase,
        initialLedgerData,
        {
          ...this.dependencies,
          sessionLease: lease,
        },
      );
      if (!this.isCurrentOperation(operation)) {
        const staleLease = lease;
        lease = null;
        await this.bestEffortRetainedRelease(staleLease);
        return staleOperationResult();
      }
      const connectionRecord: LedgerFileConnectionRecordV1 = {
        connectionFormatVersion: 1,
        handle: picked.handle,
        expectedFileId: repository.getVerifiedFileId(),
      };
      if (
        !(await this.persistConnectionRecord(
          connectionRecord,
          operation,
        ))
      ) {
        const staleLease = lease;
        lease = null;
        await this.bestEffortRetainedRelease(staleLease);
        return staleOperationResult();
      }
      this.pendingSelection = null;
      const published = this.publishSession(repository, lease);
      if (!published) {
        const unpublishableLease = lease;
        lease = null;
        await this.bestEffortRetainedRelease(unpublishableLease);
        return ownedFileSessionResult();
      }
      lease = null;
      return published;
    } catch (error) {
      if (lease) {
        await this.bestEffortRetainedRelease(lease);
      }
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      return {
        status: "error",
        ok: false,
        code: mapCreateError(error),
      };
    }
  }

  async selectExisting(): Promise<LedgerFileSelectionResult> {
    if (this.hasOwnedFileSession()) {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      };
    }
    const operation = this.beginOperation();
    try {
      const picked = await this.adapter.pickExistingLedgerFile();
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      if (picked.status === "cancelled") {
        return {
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
        };
      }

      const file = await inspectLedgerFile(this.adapter, picked.handle);
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      this.pendingSelection = {
        handle: picked.handle,
        fileId: file.fileId,
        connectionRecord: {
          connectionFormatVersion: 1,
          handle: picked.handle,
          expectedFileId: file.fileId,
        },
      };
      return { ok: true };
    } catch (error) {
      if (!this.isCurrentOperation(operation)) {
        return staleSelectionResult();
      }
      this.pendingSelection = null;
      return {
        ok: false,
        code: mapSelectionError(error),
      };
    }
  }

  async unlockSelected(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult> {
    if (this.hasOwnedFileSession()) {
      return ownedFileSessionResult();
    }
    const pending = this.pendingSelection;
    if (!pending) {
      return {
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
      };
    }
    const operation = this.operationGeneration;
    if (!validatePassphrase(passphrase).ok) {
      return {
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }

    let lease: LedgerFileSessionLease | null = null;
    try {
      const acquired = await this.coordinator.acquire(pending.handle);
      if (
        !this.isCurrentOperation(operation) ||
        this.pendingSelection !== pending
      ) {
        if (acquired.status === "acquired") {
          await this.bestEffortRetainedRelease(acquired.lease);
        }
        return staleOperationResult();
      }
      if (acquired.status !== "acquired") {
        return coordinationFailureResult(acquired.status);
      }
      lease = acquired.lease;
      const opened = await LedgerFileRepository.openForAccess(
        this.adapter,
        pending.handle,
        passphrase,
        {
          ...this.dependencies,
          expectedFileId: pending.fileId,
          sessionLease: lease,
        },
      );
      if (
        !this.isCurrentOperation(operation) ||
        this.pendingSelection !== pending
      ) {
        const staleLease = lease;
        lease = null;
        if (opened.status === "recovery-required") {
          await this.bestEffortCancelUnpublishedRecovery(
            opened.candidate,
            staleLease,
          );
        } else {
          await this.bestEffortRetainedRelease(staleLease);
        }
        return staleOperationResult();
      }
      if (opened.status === "recovery-required") {
        this.pendingSelection = null;
        const recoveryId = this.createRecoveryId();
        this.pendingRecovery = {
          recoveryId,
          candidate: opened.candidate,
          lease,
          operation,
          confirmation: null,
          cancelRequested: false,
          cancellation: null,
          connectionRecord: pending.connectionRecord,
        };
        lease = null;
        return {
          status: "recovery-required",
          ok: false,
          recoveryId,
        };
      }
      if (
        !(await this.persistConnectionRecord(
          pending.connectionRecord,
          operation,
        ))
      ) {
        const staleLease = lease;
        lease = null;
        await this.bestEffortRetainedRelease(staleLease);
        return staleOperationResult();
      }
      this.pendingSelection = null;
      const published = this.publishSession(opened.repository, lease);
      if (!published) {
        const unpublishableLease = lease;
        lease = null;
        await this.bestEffortRetainedRelease(unpublishableLease);
        return ownedFileSessionResult();
      }
      lease = null;
      return published;
    } catch (error) {
      if (lease) {
        await this.bestEffortRetainedRelease(lease);
      }
      if (
        !this.isCurrentOperation(operation) ||
        this.pendingSelection !== pending
      ) {
        return staleOperationResult();
      }
      return {
        status: "error",
        ok: false,
        code: mapUnlockError(error),
      };
    }
  }

  confirmRecovery(
    recoveryId: string,
  ): Promise<LedgerFileAccessSessionResult> {
    const pending = this.pendingRecovery;
    if (
      !pending ||
      pending.recoveryId !== recoveryId ||
      pending.cancelRequested
    ) {
      return Promise.resolve({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
      });
    }
    if (pending.confirmation) {
      return pending.confirmation;
    }

    pending.confirmation = this.finishRecovery(pending);
    return pending.confirmation;
  }

  cancelRecovery(recoveryId: string): Promise<void> {
    const pending = this.pendingRecovery;
    if (!pending || pending.recoveryId !== recoveryId) {
      return Promise.resolve();
    }
    return this.startRecoveryCancellation(pending);
  }

  cancelPendingSelection(): void {
    this.invalidateOperation();
    this.pendingSelection = null;
    const recovery = this.pendingRecovery;
    if (recovery) {
      void this.startRecoveryCancellation(recovery).catch(() => {
        // Keep the candidate so an explicit cleanup retry remains possible.
      });
    }
    for (const cleanup of this.retainedLeaseCleanups.values()) {
      void this.startRetainedLeaseCleanup(cleanup).catch(() => {
        // Keep every failed cleanup owner so a later retry remains possible.
      });
    }
  }

  private async finishRecovery(
    pending: PendingRecovery,
  ): Promise<LedgerFileAccessSessionResult> {
    try {
      const repository = await pending.candidate.confirm();
      if (
        !this.isCurrentOperation(pending.operation) ||
        this.pendingRecovery !== pending ||
        pending.cancelRequested
      ) {
        await bestEffortWait(
          this.startRecoveryCancellation(pending),
        );
        return staleOperationResult();
      }
      if (this.activeSession) {
        await bestEffortWait(
          this.startRecoveryCancellation(pending),
        );
        return ownedFileSessionResult();
      }
      if (
        !(await this.persistConnectionRecord(
          pending.connectionRecord,
          pending.operation,
        ))
      ) {
        this.pendingRecovery = null;
        await this.bestEffortRetainedRelease(pending.lease);
        return staleOperationResult();
      }
      this.pendingRecovery = null;
      const published = this.publishSession(repository, pending.lease);
      if (!published) {
        this.pendingRecovery = pending;
        await bestEffortWait(
          this.startRecoveryCancellation(pending),
        );
        return ownedFileSessionResult();
      }
      return published;
    } catch (error) {
      if (
        !this.isCurrentOperation(pending.operation) ||
        this.pendingRecovery !== pending ||
        pending.cancelRequested
      ) {
        await bestEffortWait(
          this.startRecoveryCancellation(pending),
        );
        return staleOperationResult();
      }
      pending.confirmation = null;
      return {
        status: "error",
        ok: false,
        code:
          error instanceof LedgerFileConnectionCommitError
            ? LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED
            : error instanceof LedgerFileRepositoryError &&
          error.code ===
            LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE
            ? LEDGER_FILE_ACCESS_ERROR_CODES.EXTERNAL_CHANGE
            : LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_FAILED,
      };
    }
  }

  private publishSession(
    repository: LedgerFileRepository,
    lease: LedgerFileSessionLease,
  ): LedgerFileAccessSessionResult | null {
    if (this.hasOwnedFileSession()) {
      return null;
    }
    const active = {
      session: null as unknown as LedgerSession,
      repository,
      lease,
      releaseAttempt: null,
    };
    const session = createLedgerSession({
      storageKind: "ledger-file",
      repository,
      capabilities: LEDGER_FILE_READY_IMPORT_CAPABILITIES,
      readyClearDriver: repository,
      readyImportDriver: repository,
      onBeginQuiesce: () => {
        if (this.activeSession !== active) {
          throw new Error("Ledger file session is no longer active");
        }
        this.invalidateOperation();
        this.pendingSelection = null;
      },
      release: () => this.startActiveSessionRelease(active),
    });
    active.session = session;
    this.activeSession = active;
    return { status: "unlocked", ok: true, session };
  }

  private async prepareRememberedSelection(
    record: LedgerFileConnectionRecordV1,
    operation: number,
  ): Promise<LedgerFileReconnectResult> {
    const file = await inspectLedgerFile(this.adapter, record.handle);
    if (!this.isCurrentOperation(operation)) {
      return reconnectError(LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED);
    }
    if (file.fileId !== record.expectedFileId) {
      this.pendingSelection = null;
      return reconnectError(
        LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE,
      );
    }
    this.pendingSelection = {
      handle: record.handle,
      fileId: record.expectedFileId,
      connectionRecord: record,
    };
    return { status: "ready", ok: true };
  }

  private async persistConnectionRecord(
    record: LedgerFileConnectionRecordV1,
    operation: number,
  ): Promise<boolean> {
    if (!this.isCurrentOperation(operation)) {
      return false;
    }
    if (this.connectionAdapter) {
      try {
        await this.connectionAdapter.write(
          record,
          this.operationSignal(operation),
        );
      } catch (error) {
        throw new LedgerFileConnectionCommitError(error);
      }
    }
    if (!this.isCurrentOperation(operation)) {
      return false;
    }
    this.rememberedConnection = record;
    return true;
  }

  private beginOperation(): number {
    this.invalidateOperation();
    this.pendingSelection = null;
    return this.operationGeneration;
  }

  private invalidateOperation(): void {
    this.operationAbortController.abort();
    this.operationAbortController = new AbortController();
    this.operationGeneration += 1;
  }

  private operationSignal(operation: number): AbortSignal {
    if (this.isCurrentOperation(operation)) {
      return this.operationAbortController.signal;
    }
    const stale = new AbortController();
    stale.abort();
    return stale.signal;
  }

  private isCurrentOperation(operation: number): boolean {
    return this.operationGeneration === operation;
  }

  private hasOwnedFileSession(): boolean {
    return (
      this.activeSession !== null ||
      this.pendingRecovery !== null ||
      this.retainedLeaseCleanups.size > 0
    );
  }

  private startActiveSessionRelease(
    active: ActiveLedgerFileSession,
  ): Promise<void> {
    if (active.releaseAttempt) {
      return active.releaseAttempt;
    }
    const releaseAttempt = invokePromise(() =>
      active.lease.release(),
    ).then(
      () => {
        if (this.activeSession === active) {
          this.activeSession = null;
        }
      },
      (error: unknown) => {
        if (
          this.activeSession === active &&
          active.releaseAttempt === releaseAttempt
        ) {
          active.releaseAttempt = null;
        }
        throw error;
      },
    );
    active.releaseAttempt = releaseAttempt;
    return releaseAttempt;
  }

  private bestEffortRetainedRelease(
    lease: LedgerFileSessionLease,
  ): Promise<void> {
    return this.retainAndReleaseLease(lease).catch(() => {
      // Ownership remains retained; cancelPendingSelection retries cleanup.
    });
  }

  private retainAndReleaseLease(
    lease: LedgerFileSessionLease,
  ): Promise<void> {
    const cleanup = this.retainLeaseForCleanup(lease);
    return this.startRetainedLeaseCleanup(cleanup);
  }

  private retainLeaseForCleanup(
    lease: LedgerFileSessionLease,
  ): RetainedLeaseCleanup {
    const existing = this.retainedLeaseCleanups.get(lease);
    if (existing) {
      return existing;
    }
    const cleanup = { lease, releaseAttempt: null };
    this.retainedLeaseCleanups.set(lease, cleanup);
    return cleanup;
  }

  private async bestEffortCancelUnpublishedRecovery(
    candidate: LedgerFileRecoveryCandidate,
    lease: LedgerFileSessionLease,
  ): Promise<void> {
    try {
      await candidate.cancel();
    } catch {
      this.retainLeaseForCleanup(lease);
    }
  }

  private startRetainedLeaseCleanup(
    cleanup: RetainedLeaseCleanup,
  ): Promise<void> {
    if (cleanup.releaseAttempt) {
      return cleanup.releaseAttempt;
    }
    const releaseAttempt = invokePromise(() =>
      cleanup.lease.release(),
    ).then(
      () => {
        if (
          this.retainedLeaseCleanups.get(cleanup.lease) === cleanup
        ) {
          this.retainedLeaseCleanups.delete(cleanup.lease);
        }
      },
      (error: unknown) => {
        if (
          this.retainedLeaseCleanups.get(cleanup.lease) === cleanup &&
          cleanup.releaseAttempt === releaseAttempt
        ) {
          cleanup.releaseAttempt = null;
        }
        throw error;
      },
    );
    cleanup.releaseAttempt = releaseAttempt;
    return releaseAttempt;
  }

  private startRecoveryCancellation(
    pending: PendingRecovery,
  ): Promise<void> {
    if (pending.cancellation) {
      return pending.cancellation;
    }
    if (!pending.cancelRequested) {
      pending.cancelRequested = true;
      this.invalidateOperation();
    }

    const cancellation = invokePromise(() =>
      pending.candidate.cancel(),
    ).then(
      () => {
        if (this.pendingRecovery === pending) {
          this.pendingRecovery = null;
        }
      },
      (error: unknown) => {
        if (
          this.pendingRecovery === pending &&
          pending.cancellation === cancellation
        ) {
          pending.cancellation = null;
        }
        throw error;
      },
    );
    pending.cancellation = cancellation;
    return cancellation;
  }
}

function staleOperationResult(): {
  status: "error";
  ok: false;
  code: typeof LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED;
} {
  return {
    status: "error",
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
  };
}

function staleSelectionResult(): {
  ok: false;
  code: typeof LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED;
} {
  return {
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
  };
}

function reconnectError(
  code: LedgerFileAccessErrorCode,
): Extract<LedgerFileReconnectResult, { status: "error" }> {
  return {
    status: "error",
    ok: false,
    code,
  };
}

function coordinationFailureResult(
  status: "in-use" | "unsupported" | "coordination-failed",
): LedgerFileAccessSessionResult {
  if (status === "in-use") {
    return {
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    };
  }
  return {
    status: "error",
    ok: false,
    code:
      status === "unsupported"
        ? LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED
        : LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED,
  };
}

function ownedFileSessionResult(): LedgerFileAccessSessionResult {
  return {
    status: "error",
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
  };
}

function mapCreateError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileConnectionCommitError) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED;
  }
  if (error instanceof LedgerFileAdapterError) {
    if (error.stage === "extension") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION;
    }
    if (error.stage === "target") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET;
    }
    if (
      error.stage === "picker" &&
      error.message.includes("unavailable")
    ) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE;
    }
  }

  return LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED;
}

function mapSelectionError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileAdapterError) {
    if (error.stage === "extension") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION;
    }
    if (
      error.stage === "picker" &&
      error.message.includes("unavailable")
    ) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE;
    }
  }
  if (
    error instanceof LedgerFileRepositoryError &&
    error.code === LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE
  ) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE;
  }

  return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE;
}

function mapUnlockError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileConnectionCommitError) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_SAVE_FAILED;
  }
  if (
    error instanceof LedgerFileRepositoryError &&
    error.code === LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE
  ) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.EXTERNAL_CHANGE;
  }
  return LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED;
}

function mapReconnectError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileConnectionRecordError) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.CONNECTION_INVALID;
  }
  if (
    error instanceof LedgerFileAdapterError &&
    (error.stage === "permission-query" ||
      error.stage === "permission-request")
  ) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED;
  }
  return LEDGER_FILE_ACCESS_ERROR_CODES.RECONNECT_FAILED;
}

async function bestEffortWait(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch {
    // The retained owner keeps the controller fail-closed for an explicit retry.
  }
}

function invokePromise(operation: () => Promise<void>): Promise<void> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}

function defaultCreateRecoveryId(): string {
  return globalThis.crypto.randomUUID();
}
