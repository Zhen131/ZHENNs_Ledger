import { type LedgerFileHandleAdapter } from "./ledgerFileHandleAdapter";
import { type LedgerFileHandle } from "./ledgerFileHandleAdapterContract";
import {
  createCanonicalLedgerPayloadV4,
  type CanonicalLedgerPayloadV4,
} from "./ledgerFileContract";
import { type LedgerFileV3S3 } from "./ledgerFileChunkedContainerV3";
import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";
import { createLedgerDataContentIdentity } from "@/platform/persistence";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import type { LedgerData } from "@/core/models";
import {
  claimReadyLedgerImportExecutionContextForDriver,
  claimReadyLedgerClearExecutionContextForDriver,
  createReadyLedgerImportAuthorizationForDriver,
  createReadyLedgerClearAuthorizationForDriver,
  isReadyLedgerImportAuthorizationContextForDriver,
  isReadyLedgerClearAuthorizationContextForDriver,
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerRepositoryError,
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  type LedgerReadyClearDriver,
  type LedgerReadyImportDriver,
  type LedgerRepository,
  type ReadyLedgerClearAuthorization,
  type ReadyLedgerClearAuthorizationContext,
  type ReadyLedgerClearExecutionContext,
  type ReadyLedgerImportAuthorization,
  type ReadyLedgerImportAuthorizationContext,
  type ReadyLedgerImportExecutionContext,
} from "@/platform/persistence";
import {
  createInitialLedgerData,
  ledgerReducer,
  type LedgerAction,
} from "@/core/state";
import type {
  LedgerFileRepositorySessionDependencies,
} from "./ledgerFileRepositoryContract";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "./ledgerFileRepositoryContract";
import type {
  VerifiedGeneration,
  VerifiedLedgerFile,
  PendingSaveIntent,
  PendingRecoveryIntent,
  PendingClearIntent,
  PendingImportIntent,
} from "./ledgerFileRepositoryIntents";
import {
  sameBytes,
  retimeCanonicalLedgerPayloadV4,
  createCanonicalPayloadAfterBuyTrade,
  collectLedgerFactIds,
} from "./ledgerFileRepositoryPayload";
import {
  createIntentKey,
  mapAdapterWriteError,
  externalChangeError,
  clearAuthorizationError,
  importAuthorizationError,
  importRecoveryBlockedError,
  assertImportActive,
  defaultGenerateId,
} from "./ledgerFileRepositorySupport";
import {
  expectedFromPending,
  expectedFromRecovery,
  verifySerializedLedgerFile,
  verifyLedgerFile,
  verifyLedgerFileForOpen,
  parseAndValidateLedgerFile,
  parseAndValidateLedgerFileCandidates,
  assertValidLedgerFile,
  serializeLedgerFile,
} from "./ledgerFileRepositoryVerify";
import {
  writePreparedLedgerFile,
  createInitialLedgerFileV3S3,
  prepareNextLedgerFileV3S3,
  collectLedgerFileBodySlots,
  collectLedgerFileIvBase64Urls,
} from "./ledgerFileRepositoryWrite";

type ReadyClearAuthorizationRuntime = {
  readonly repository: LedgerFileRepository;
  readonly authorization: ReadyLedgerClearAuthorization;
  state: "authorized" | "in-flight" | "consumed";
  promise: Promise<void> | null;
};

const readyClearAuthorizationRuntimes = new WeakMap<
  ReadyLedgerClearAuthorization,
  ReadyClearAuthorizationRuntime
>();

type ReadyImportAuthorizationRuntime = {
  readonly repository: LedgerFileRepository;
  readonly authorization: ReadyLedgerImportAuthorization;
  state: "authorized" | "in-flight" | "consumed" | "blocked";
  promise: Promise<LedgerData> | null;
};

const readyImportAuthorizationRuntimes = new WeakMap<
  ReadyLedgerImportAuthorization,
  ReadyImportAuthorizationRuntime
>();

export type LedgerFileOpenResult =
  | { status: "opened"; repository: LedgerFileRepository }
  | {
      status: "recovery-required";
      candidate: LedgerFileRecoveryCandidate;
    };

export class LedgerFileRepository
  implements
    LedgerRepository,
    LedgerReadyClearDriver,
    LedgerReadyImportDriver
{
  private pendingIntent: PendingSaveIntent | null = null;
  private pendingClearIntent: PendingClearIntent | null = null;
  private activeClearAuthorization:
    | ReadyLedgerClearAuthorization
    | null = null;
  private pendingImportIntent: PendingImportIntent | null = null;
  private activeImportAuthorization:
    | ReadyLedgerImportAuthorization
    | null = null;
  private latestSaveRequest = 0;
  private actionSaveChainBroken = false;
  private verifiedFactIds: Set<string>;

  private constructor(
    private readonly adapter: LedgerFileHandleAdapter,
    private readonly handle: LedgerFileHandle,
    private readonly crypto: LedgerFileCrypto,
    private verified: VerifiedLedgerFile,
    private readonly sessionLease: LedgerFileSessionLease,
    private readonly generateId: () => string,
    private readonly now: () => Date,
  ) {
    this.verifiedFactIds = collectLedgerFactIds(
      verified.current.payload.ledgerData,
    );
  }

  private acceptVerified(
    verified: VerifiedLedgerFile,
    appendedFactId?: string,
  ): void {
    this.verified = verified;
    if (appendedFactId !== undefined) {
      this.verifiedFactIds.add(appendedFactId);
      return;
    }
    this.verifiedFactIds = collectLedgerFactIds(
      verified.current.payload.ledgerData,
    );
  }

  getVerifiedFileId(): string {
    return this.verified.file.fileId;
  }

  getVerifiedRevisionId(): string {
    return this.verified.file.current.revisionId;
  }

  verifyCurrentDiskState(): Promise<void> {
    return this.sessionLease.runExclusiveWrite(() =>
      this.assertDiskMatchesVerified(),
    );
  }

  static async create(
    adapter: LedgerFileHandleAdapter,
    handle: LedgerFileHandle,
    passphrase: string,
    initialLedgerData: unknown,
    dependencies: LedgerFileRepositorySessionDependencies,
  ): Promise<LedgerFileRepository> {
    const { sessionLease } = dependencies;
    return sessionLease.runExclusiveWrite(async () => {
      await adapter.assertEmptyCreateTarget(handle);
      const crypto = await LedgerFileCrypto.createForSetup(
        passphrase,
        dependencies.cryptoProvider,
      );
      const generateId = dependencies.generateId ?? defaultGenerateId;
      const now = dependencies.now ?? (() => new Date());
      const fileId = generateId();
      const revisionId = generateId();
      const payloadResult = createCanonicalLedgerPayloadV4(
        initialLedgerData,
        now().toISOString(),
      );

      if (!payloadResult.ok) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
          "Initial ledger data failed the file payload contract",
          payloadResult.errors,
        );
      }

      const file = await createInitialLedgerFileV3S3(
        crypto,
        fileId,
        {
          revisionId,
          parentRevisionId: null,
        },
        payloadResult.value,
      );
      assertValidLedgerFile(file);
      const serializedFile = serializeLedgerFile(file);
      let readback: Uint8Array;
      try {
        readback = (
          await adapter.writeBinaryAndReadBack(handle, serializedFile)
        ).bytes;
      } catch (error) {
        throw mapAdapterWriteError(error);
      }

      const verified = await verifySerializedLedgerFile(
        readback,
        crypto,
        {
          file,
          fileId,
          currentRevisionId: revisionId,
          currentParentRevisionId: null,
          currentGeneration: file.current,
          currentPayload: payloadResult.value,
          currentBlockSerializedPayloads: null,
          previousGeneration: null,
          previousPayload: null,
          serializedFile,
          reachableBodySlots: collectLedgerFileBodySlots(file),
          reachableIvBase64Urls: collectLedgerFileIvBase64Urls([file]),
        },
      );

      return new LedgerFileRepository(
        adapter,
        handle,
        crypto,
        verified,
        sessionLease,
        generateId,
        now,
      );
    });
  }

  static async open(
    adapter: LedgerFileHandleAdapter,
    handle: LedgerFileHandle,
    passphrase: string,
    dependencies: LedgerFileRepositorySessionDependencies & {
      expectedFileId?: string;
    },
  ): Promise<LedgerFileRepository> {
    const result = await LedgerFileRepository.openForAccess(
      adapter,
      handle,
      passphrase,
      dependencies,
    );
    if (result.status === "opened") {
      return result.repository;
    }
    await result.candidate.cancel();
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Current ledger file generation requires explicit recovery",
    );
  }

  static async openForAccess(
    adapter: LedgerFileHandleAdapter,
    handle: LedgerFileHandle,
    passphrase: string,
    dependencies: LedgerFileRepositorySessionDependencies & {
      expectedFileId?: string;
    },
  ): Promise<LedgerFileOpenResult> {
    const read = await adapter.readBinary(handle);
    const parsed = parseAndValidateLedgerFileCandidates(read.bytes);
    const reachableIvBase64Urls = collectLedgerFileIvBase64Urls(
      parsed.candidates.map(({ file }) => file),
    );
    const generateId = dependencies.generateId ?? defaultGenerateId;
    const now = dependencies.now ?? (() => new Date());
    let firstError: unknown;
    let foundExpectedFileId = dependencies.expectedFileId === undefined;

    for (let index = 0; index < parsed.candidates.length; index += 1) {
      const headerCandidate = parsed.candidates[index]!;
      if (!headerCandidate.referencedPaddingIsZero) {
        firstError ??= new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
          "Ledger file has no unique complete V3 S-3 header candidate",
        );
        continue;
      }
      const file = headerCandidate.file;
      if (
        dependencies.expectedFileId !== undefined &&
        file.fileId !== dependencies.expectedFileId
      ) {
        continue;
      }
      foundExpectedFileId = true;
      const crypto = await LedgerFileCrypto.createForUnlock(
        passphrase,
        file.crypto,
        dependencies.cryptoProvider,
      );
      let verified: Awaited<ReturnType<typeof verifyLedgerFileForOpen>>;
      try {
        verified = await verifyLedgerFileForOpen(
          file,
          read.bytes,
          crypto,
          parsed.reachableBodySlots,
          reachableIvBase64Urls,
        );
      } catch (error) {
        firstError ??= error;
        continue;
      }

      const olderHeaderRecovery = index > 0;
      if (
        verified.status === "recovery-required" ||
        olderHeaderRecovery
      ) {
        const recoverySource =
          verified.status === "recovery-required"
            ? verified.previous
            : verified.verified.current;
        return {
          status: "recovery-required",
          candidate: new LedgerFileRecoveryCandidate(
            adapter,
            handle,
            crypto,
            file,
            read.bytes,
            parsed.reachableBodySlots,
            reachableIvBase64Urls,
            recoverySource,
            dependencies.sessionLease,
            generateId,
            now,
          ),
        };
      }

      return {
        status: "opened",
        repository: new LedgerFileRepository(
          adapter,
          handle,
          crypto,
          verified.verified,
          dependencies.sessionLease,
          generateId,
          now,
        ),
      };
    }

    if (!foundExpectedFileId) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
        "Selected ledger file identity changed before unlock",
      );
    }
    throw firstError instanceof Error
      ? firstError
      : new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
          "Ledger file generations could not be authenticated and validated",
          firstError,
        );
  }

  static fromRecoveredState(
    adapter: LedgerFileHandleAdapter,
    handle: LedgerFileHandle,
    crypto: LedgerFileCrypto,
    verified: VerifiedLedgerFile,
    sessionLease: LedgerFileSessionLease,
    generateId: () => string,
    now: () => Date,
  ): LedgerFileRepository {
    return new LedgerFileRepository(
      adapter,
      handle,
      crypto,
      verified,
      sessionLease,
      generateId,
      now,
    );
  }

  async load(): Promise<LedgerData> {
    if (this.isImportRecoveryBlocked()) {
      throw importRecoveryBlockedError(
        "The current disk state is unknown after a blocked import recovery",
      );
    }
    if (this.pendingImportIntent || this.isImportInFlight()) {
      throw importAuthorizationError(
        "A ledger-file import is still reconciling its disk state",
      );
    }
    return structuredClone(this.verified.current.payload.ledgerData);
  }

  async save(candidate: LedgerData): Promise<void> {
    if (
      this.pendingImportIntent ||
      this.isImportAuthorizationActive()
    ) {
      throw importAuthorizationError(
        "A ledger-file import authorization already owns the next write",
      );
    }
    const candidateValidation = createCanonicalLedgerPayloadV4(
      candidate,
      this.verified.current.payload.savedAt,
    );
    if (!candidateValidation.ok) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Ledger data failed validation before file save",
        candidateValidation.errors,
      );
    }
    const saveRequest = this.latestSaveRequest + 1;
    this.latestSaveRequest = saveRequest;
    return this.sessionLease
      .runExclusiveWrite(() =>
        saveRequest === this.latestSaveRequest
          ? this.saveExclusive(candidateValidation.value)
          : Promise.resolve(),
      )
      .then(() => {
        this.actionSaveChainBroken = false;
      });
  }

  async saveAfterAction(action: LedgerAction): Promise<void> {
    if (
      this.pendingImportIntent ||
      this.isImportAuthorizationActive()
    ) {
      throw importAuthorizationError(
        "A ledger-file import authorization already owns the next write",
      );
    }
    return this.sessionLease
      .runExclusiveWrite(async () => {
        if (this.actionSaveChainBroken) {
          throw new LedgerFileRepositoryError(
            LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
            "A failed action save must be retried from the full ledger snapshot",
          );
        }
        const fastPayload =
          action.type === "trade/add" &&
          action.trade.type === "buy" &&
          !this.verifiedFactIds.has(action.trade.id)
            ? createCanonicalPayloadAfterBuyTrade(
                this.verified.current.payload.ledgerData,
                action.trade,
                this.verified.current.payload.savedAt,
              )
            : null;
        const candidateValidation = fastPayload
          ? { ok: true as const, value: fastPayload }
          : createCanonicalLedgerPayloadV4(
              ledgerReducer(
                this.verified.current.payload.ledgerData,
                action,
              ),
              this.verified.current.payload.savedAt,
            );
        if (!candidateValidation.ok) {
          throw new LedgerFileRepositoryError(
            LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
            "Ledger action failed validation before file save",
            candidateValidation.errors,
          );
        }
        await this.saveExclusive(
          candidateValidation.value,
          fastPayload ? action : undefined,
        );
      })
      .catch((error: unknown) => {
        this.actionSaveChainBroken = true;
        throw error;
      });
  }

  private async saveExclusive(
    candidateForComparison: CanonicalLedgerPayloadV4,
    action?: LedgerAction,
  ): Promise<void> {
    if (
      this.pendingImportIntent ||
      this.isImportAuthorizationActive()
    ) {
      throw importAuthorizationError(
        "A ledger-file import must finish recovery before saving",
      );
    }
    if (this.pendingClearIntent) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
        "A ledger-file clear intent must be reconciled before saving",
      );
    }
    if (this.pendingIntent) {
      const pendingResult = await this.reconcilePendingIntent();
      if (
        pendingResult === "committed" &&
        candidateForComparison.serializedLedgerData ===
          this.verified.current.serializedLedgerData
      ) {
        return;
      }

      if (pendingResult === "base") {
        const key = createIntentKey(
          this.verified.file.fileId,
          this.verified.file.current.revisionId,
          candidateForComparison.serializedLedgerData,
        );
        if (this.pendingIntent?.key === key) {
          await this.writePendingIntent(this.pendingIntent);
          return;
        }
        this.pendingIntent = null;
      }
    } else {
      await this.assertDiskMatchesVerified(false);
    }

    if (
      candidateForComparison.serializedLedgerData ===
      this.verified.current.serializedLedgerData
    ) {
      return;
    }

    const payload = retimeCanonicalLedgerPayloadV4(
      candidateForComparison,
      this.now().toISOString(),
    );

    const baseFile = this.verified.file;
    const revisionId = this.generateId();
    if (revisionId === baseFile.current.revisionId) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Revision generator returned the current revision",
      );
    }

    const prepared = await prepareNextLedgerFileV3S3(
      this.crypto,
      baseFile,
      this.verified.serializedFile,
      this.verified.reachableBodySlots,
      this.verified.current,
      payload,
      revisionId,
      this.verified.reachableIvBase64Urls,
      action,
    );
    const pendingIntent: PendingSaveIntent = {
      key: createIntentKey(
        baseFile.fileId,
        baseFile.current.revisionId,
        payload.serializedLedgerData,
      ),
      baseFile,
      baseSerializedFile: this.verified.serializedFile,
      baseCurrent: this.verified.current,
      file: prepared.file,
      serializedFile: prepared.serializedFile,
      writeMode: prepared.mode,
      patches: prepared.patches,
      expectedCurrent: payload,
      expectedCurrentBlockPayloads:
        prepared.expectedCurrentBlockPayloads,
      expectedReachableBodySlots:
        prepared.expectedReachableBodySlots,
      expectedReachableIvBase64Urls:
        prepared.expectedReachableIvBase64Urls,
      ...(action?.type === "trade/add"
        ? { appendedFactId: action.trade.id }
        : {}),
    };
    this.pendingIntent = pendingIntent;
    await this.writePendingIntent(pendingIntent);
  }

  async clear(): Promise<void> {
    throw new LedgerRepositoryError(
      LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
      "Clearing a ledger file is not available in this batch",
      new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_UNSUPPORTED,
        "Ledger file clear is not implemented",
      ),
    );
  }

  authorizeReadyClear(
    context: ReadyLedgerClearAuthorizationContext,
  ): ReadyLedgerClearAuthorization | null {
    if (
      context.confirmationNonce !==
        READY_LEDGER_CLEAR_CONFIRMATION_TEXT ||
      !isReadyLedgerClearAuthorizationContextForDriver(
        context,
        this,
      ) ||
      this.pendingIntent ||
      this.pendingImportIntent ||
      this.isImportAuthorizationActive()
    ) {
      return null;
    }

    if (this.pendingClearIntent && this.activeClearAuthorization) {
      const existing = this.activeClearAuthorization;
      const runtime = readyClearAuthorizationRuntimes.get(existing);
      return runtime &&
        runtime.repository === this &&
        runtime.state === "authorized" &&
        existing.sessionId === context.sessionId &&
        existing.generation === context.generation &&
        existing.confirmationNonce === context.confirmationNonce
        ? existing
        : null;
    }

    if (this.activeClearAuthorization) {
      const runtime = readyClearAuthorizationRuntimes.get(
        this.activeClearAuthorization,
      );
      if (runtime && runtime.state === "authorized") {
        const existing = this.activeClearAuthorization;
        return existing.sessionId === context.sessionId &&
          existing.generation === context.generation &&
          existing.confirmationNonce === context.confirmationNonce
          ? existing
          : null;
      }
      if (runtime && runtime.state === "in-flight") {
        return null;
      }
      this.activeClearAuthorization = null;
    }

    const authorization =
      createReadyLedgerClearAuthorizationForDriver(context, {
        fileId: this.verified.file.fileId,
        verifiedRevisionId:
          this.verified.file.current.revisionId,
      });
    readyClearAuthorizationRuntimes.set(authorization, {
      repository: this,
      authorization,
      state: "authorized",
      promise: null,
    });
    this.activeClearAuthorization = authorization;
    return authorization;
  }

  clearReadyLedger(
    authorization: ReadyLedgerClearAuthorization,
    executionContext: ReadyLedgerClearExecutionContext,
  ): Promise<void> {
    const runtime =
      readyClearAuthorizationRuntimes.get(authorization);
    if (
      !claimReadyLedgerClearExecutionContextForDriver(
        executionContext,
        authorization,
        this,
      ) ||
      !runtime ||
      runtime.repository !== this ||
      runtime.authorization !== authorization ||
      this.activeClearAuthorization !== authorization
    ) {
      return Promise.reject(clearAuthorizationError());
    }
    if (runtime.state === "consumed") {
      return Promise.reject(clearAuthorizationError());
    }
    if (runtime.state === "in-flight") {
      return runtime.promise ?? Promise.reject(clearAuthorizationError());
    }

    runtime.state = "in-flight";
    const promise = this.sessionLease
      .runExclusiveWrite(() =>
        this.clearReadyLedgerExclusive(authorization),
      )
      .then(
        () => {
          runtime.state = "consumed";
        },
        (error: unknown) => {
          runtime.state = "authorized";
          throw error;
        },
      )
      .finally(() => {
        runtime.promise = null;
      });
    runtime.promise = promise;
    return promise;
  }

  authorizeReadyImport(
    context: ReadyLedgerImportAuthorizationContext,
  ): ReadyLedgerImportAuthorization | null {
    if (
      !isReadyLedgerImportAuthorizationContextForDriver(
        context,
        this,
      ) ||
      this.pendingIntent ||
      this.pendingClearIntent ||
      this.pendingImportIntent ||
      this.isClearAuthorizationActive() ||
      !this.isVerifiedNewEmptyLedger()
    ) {
      return null;
    }

    if (this.activeImportAuthorization) {
      const existing = this.activeImportAuthorization;
      const runtime = readyImportAuthorizationRuntimes.get(existing);
      if (
        runtime &&
        runtime.repository === this &&
        runtime.state === "authorized" &&
        existing.sessionId === context.sessionId &&
        existing.generation === context.generation &&
        existing.hookGeneration === context.hookGeneration &&
        existing.contentIdentity === context.contentIdentity &&
        existing.candidateIdentity === context.candidateIdentity &&
        existing.selectionGeneration === context.selectionGeneration &&
        existing.suspiciousGroupIdentity ===
          context.suspiciousGroupIdentity &&
        existing.requireHistoricalRawText ===
          context.requireHistoricalRawText
      ) {
        return existing;
      }
      if (
        runtime?.state === "in-flight" ||
        runtime?.state === "blocked"
      ) {
        return null;
      }
      this.activeImportAuthorization = null;
    }

    const authorization =
      createReadyLedgerImportAuthorizationForDriver(context, {
        fileId: this.verified.file.fileId,
        verifiedRevisionId:
          this.verified.file.current.revisionId,
      });
    readyImportAuthorizationRuntimes.set(authorization, {
      repository: this,
      authorization,
      state: "authorized",
      promise: null,
    });
    this.activeImportAuthorization = authorization;
    return authorization;
  }

  importReadyLedger(
    authorization: ReadyLedgerImportAuthorization,
    candidate: LedgerData,
    executionContext: ReadyLedgerImportExecutionContext,
  ): Promise<LedgerData> {
    const runtime =
      readyImportAuthorizationRuntimes.get(authorization);
    if (
      !runtime ||
      runtime.repository !== this ||
      runtime.authorization !== authorization ||
      this.activeImportAuthorization !== authorization ||
      runtime.state !== "authorized"
    ) {
      return Promise.reject(importAuthorizationError());
    }

    runtime.state = "in-flight";
    const promise = this.sessionLease
      .runExclusiveWrite(async () => {
        if (
          !claimReadyLedgerImportExecutionContextForDriver(
            executionContext,
            authorization,
            this,
          )
        ) {
          throw importAuthorizationError(
            "Ready ledger import was cancelled before its exclusive claim",
          );
        }
        return this.importReadyLedgerExclusive(
          authorization,
          candidate,
          executionContext.signal,
        );
      })
      .then(
        (ledgerData) => {
          runtime.state = "consumed";
          if (this.activeImportAuthorization === authorization) {
            this.activeImportAuthorization = null;
          }
          return ledgerData;
        },
        (error: unknown) => {
          const blocked =
            error instanceof LedgerFileRepositoryError &&
            error.code ===
              LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED;
          runtime.state = blocked ? "blocked" : "consumed";
          if (
            !blocked &&
            this.activeImportAuthorization === authorization
          ) {
            this.activeImportAuthorization = null;
          }
          throw error;
        },
      )
      .finally(() => {
        runtime.promise = null;
      });
    runtime.promise = promise;
    return promise;
  }

  private async importReadyLedgerExclusive(
    authorization: ReadyLedgerImportAuthorization,
    candidate: LedgerData,
    signal: AbortSignal,
  ): Promise<LedgerData> {
    const runtime =
      readyImportAuthorizationRuntimes.get(authorization);
    if (
      !runtime ||
      runtime.repository !== this ||
      runtime.state !== "in-flight" ||
      this.activeImportAuthorization !== authorization ||
      this.pendingIntent ||
      this.pendingClearIntent ||
      this.pendingImportIntent ||
      this.isClearAuthorizationActive()
    ) {
      throw importAuthorizationError();
    }
    assertImportActive(signal);

    if (
      authorization.fileId !== this.verified.file.fileId ||
      authorization.verifiedRevisionId !==
        this.verified.file.current.revisionId ||
      !this.isVerifiedNewEmptyLedger()
    ) {
      throw importAuthorizationError(
        "Ready ledger import no longer targets the authorized new empty C",
      );
    }

    const comparison = createCanonicalLedgerPayloadV4(
      candidate,
      this.verified.current.payload.savedAt,
    );
    if (
      !comparison.ok
    ) {
      throw importAuthorizationError(
        "Ready ledger import candidate no longer matches its authorization",
      );
    }
    if (
      authorization.requireHistoricalRawText &&
      comparison.value.value.ledgerData.trades.some(
        (trade) =>
          typeof trade.rawText !== "string" ||
          trade.rawText.trim().length === 0,
      )
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Historical ledger-file import requires non-empty rawText for every trade",
      );
    }
    const candidateIdentity = await createLedgerDataContentIdentity(
      comparison.value.value.ledgerData,
    );
    assertImportActive(signal);
    if (candidateIdentity !== authorization.candidateIdentity) {
      throw importAuthorizationError(
        "Ready ledger import candidate no longer matches its authorization",
      );
    }

    await this.assertDiskMatchesVerified();
    assertImportActive(signal);

    const payloadResult = createCanonicalLedgerPayloadV4(
      candidate,
      this.now().toISOString(),
    );
    if (!payloadResult.ok) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Ledger data failed the import payload contract",
        payloadResult.errors,
      );
    }
    const baseFile = this.verified.file;
    const baseCurrent = this.verified.current;
    const revisionId = this.generateId();
    if (
      revisionId === baseFile.current.revisionId ||
      revisionId === baseFile.previous?.revisionId
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Revision generator returned an existing import revision",
      );
    }
    const prepared = await prepareNextLedgerFileV3S3(
      this.crypto,
      baseFile,
      this.verified.serializedFile,
      this.verified.reachableBodySlots,
      this.verified.current,
      payloadResult.value,
      revisionId,
      this.verified.reachableIvBase64Urls,
    );
    assertImportActive(signal);
    await this.assertDiskMatchesVerified();
    assertImportActive(signal);
    const pending: PendingImportIntent = {
      authorization,
      key: createIntentKey(
        baseFile.fileId,
        baseFile.current.revisionId,
        payloadResult.value.serializedLedgerData,
      ),
      baseFile,
      baseSerializedFile: this.verified.serializedFile,
      baseCurrent,
      file: prepared.file,
      serializedFile: prepared.serializedFile,
      writeMode: prepared.mode,
      patches: prepared.patches,
      expectedCurrent: payloadResult.value,
      expectedCurrentBlockPayloads:
        prepared.expectedCurrentBlockPayloads,
      expectedReachableBodySlots:
        prepared.expectedReachableBodySlots,
      expectedReachableIvBase64Urls:
        prepared.expectedReachableIvBase64Urls,
    };
    this.pendingImportIntent = pending;
    let writeAttempted = false;

    try {
      assertImportActive(signal);
      writeAttempted = true;
      const readback = await writePreparedLedgerFile(
        this.adapter,
        this.handle,
        pending,
        signal,
      );
      assertImportActive(signal);
      if (!sameBytes(readback, pending.serializedFile)) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
          "Ledger-file import readback did not match the exact transaction bytes",
        );
      }
      const verified = await verifySerializedLedgerFile(
        readback,
        this.crypto,
        expectedFromPending(pending),
      );
      assertImportActive(signal);
      this.acceptVerified(verified);
      this.pendingImportIntent = null;
      return structuredClone(verified.current.payload.ledgerData);
    } catch (error) {
      if (!writeAttempted) {
        this.pendingImportIntent = null;
        throw error;
      }
      await this.restoreImportBaseline(pending, error);
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED,
        "Ledger-file import failed; the exact pre-import C was restored and verified",
        error,
      );
    }
  }

  private async restoreImportBaseline(
    pending: PendingImportIntent,
    originalError: unknown,
  ): Promise<void> {
    let currentText: Uint8Array;
    try {
      currentText = (await this.adapter.readBinary(this.handle)).bytes;
    } catch (firstReadError) {
      throw importRecoveryBlockedError({
        originalError,
        firstReadError,
      });
    }
    if (sameBytes(currentText, pending.baseSerializedFile)) {
      try {
        this.acceptVerified(
          await verifySerializedLedgerFile(currentText, this.crypto),
        );
        this.pendingImportIntent = null;
        return;
      } catch (baseVerificationError) {
        throw importRecoveryBlockedError({
          originalError,
          baseVerificationError,
        });
      }
    }
    if (!sameBytes(currentText, pending.serializedFile)) {
      throw importRecoveryBlockedError({
        originalError,
        firstRead:
          "Disk bytes were neither the exact pre-import base nor this transaction's exact candidate",
      });
    }

    let compensationError: unknown;
    try {
      const restored = (
        await this.adapter.writeBinaryAndReadBack(
          this.handle,
          pending.baseSerializedFile,
        )
      ).bytes;
      if (!sameBytes(restored, pending.baseSerializedFile)) {
        throw new Error(
          "Compensation readback did not match the exact pre-import bytes",
        );
      }
      this.acceptVerified(
        await verifySerializedLedgerFile(restored, this.crypto),
      );
      this.pendingImportIntent = null;
      return;
    } catch (error) {
      compensationError = error;
    }

    try {
      const finalText = (await this.adapter.readBinary(this.handle)).bytes;
      if (!sameBytes(finalText, pending.baseSerializedFile)) {
        throw new Error(
          "Final compensation readback did not match the exact pre-import bytes",
        );
      }
      this.acceptVerified(
        await verifySerializedLedgerFile(finalText, this.crypto),
      );
      this.pendingImportIntent = null;
      return;
    } catch (finalReadError) {
      throw importRecoveryBlockedError({
        originalError,
        compensationError,
        finalReadError,
      });
    }
  }

  private isVerifiedNewEmptyLedger(): boolean {
    if (
      this.verified.previous !== null ||
      this.verified.file.previous !== null ||
      this.verified.file.current.parentRevisionId !== null
    ) {
      return false;
    }
    const initial = createCanonicalLedgerPayloadV4(
      createInitialLedgerData(),
      this.verified.current.payload.savedAt,
    );
    return (
      initial.ok &&
      initial.value.serializedLedgerData ===
        this.verified.current.serializedLedgerData
    );
  }

  private isClearAuthorizationActive(): boolean {
    if (!this.activeClearAuthorization) {
      return false;
    }
    const runtime = readyClearAuthorizationRuntimes.get(
      this.activeClearAuthorization,
    );
    return (
      runtime?.state === "authorized" ||
      runtime?.state === "in-flight"
    );
  }

  private isImportInFlight(): boolean {
    if (!this.activeImportAuthorization) {
      return false;
    }
    const runtime = readyImportAuthorizationRuntimes.get(
      this.activeImportAuthorization,
    );
    return (
      runtime?.state === "in-flight"
    );
  }

  private isImportRecoveryBlocked(): boolean {
    if (!this.activeImportAuthorization) {
      return false;
    }
    return (
      readyImportAuthorizationRuntimes.get(
        this.activeImportAuthorization,
      )?.state === "blocked"
    );
  }

  private isImportAuthorizationActive(): boolean {
    if (!this.activeImportAuthorization) {
      return false;
    }
    const runtime = readyImportAuthorizationRuntimes.get(
      this.activeImportAuthorization,
    );
    return (
      runtime?.state === "authorized" ||
      runtime?.state === "in-flight" ||
      runtime?.state === "blocked"
    );
  }

  private async clearReadyLedgerExclusive(
    authorization: ReadyLedgerClearAuthorization,
  ): Promise<void> {
    const runtime =
      readyClearAuthorizationRuntimes.get(authorization);
    if (
      !runtime ||
      runtime.repository !== this ||
      runtime.state !== "in-flight" ||
      this.activeClearAuthorization !== authorization
    ) {
      throw clearAuthorizationError();
    }

    if (this.pendingClearIntent) {
      if (
        this.pendingClearIntent.authorization !== authorization
      ) {
        throw clearAuthorizationError();
      }
      const result = await this.reconcilePendingClearIntent();
      if (result === "committed") {
        return;
      }
      await this.writePendingClearIntent(this.pendingClearIntent);
      return;
    }

    if (
      authorization.fileId !== this.verified.file.fileId ||
      authorization.verifiedRevisionId !==
        this.verified.file.current.revisionId
    ) {
      throw clearAuthorizationError();
    }

    await this.assertDiskMatchesVerified();
    const baseFile = this.verified.file;
    const baseCurrent = this.verified.current;
    const payloadResult = createCanonicalLedgerPayloadV4(
      createInitialLedgerData(),
      this.now().toISOString(),
    );
    if (!payloadResult.ok) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Initial ledger data failed the clear payload contract",
        payloadResult.errors,
      );
    }
    const revisionId = this.generateId();
    if (
      revisionId === baseFile.current.revisionId ||
      revisionId === baseFile.previous?.revisionId
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Revision generator returned an existing clear revision",
      );
    }
    const prepared = await prepareNextLedgerFileV3S3(
      this.crypto,
      baseFile,
      this.verified.serializedFile,
      this.verified.reachableBodySlots,
      this.verified.current,
      payloadResult.value,
      revisionId,
      this.verified.reachableIvBase64Urls,
    );
    const pending: PendingClearIntent = {
      authorization,
      key: createIntentKey(
        baseFile.fileId,
        baseFile.current.revisionId,
        payloadResult.value.serializedLedgerData,
      ),
      baseFile,
      baseSerializedFile: this.verified.serializedFile,
      baseCurrent,
      file: prepared.file,
      serializedFile: prepared.serializedFile,
      writeMode: prepared.mode,
      patches: prepared.patches,
      expectedCurrent: payloadResult.value,
      expectedCurrentBlockPayloads:
        prepared.expectedCurrentBlockPayloads,
      expectedReachableBodySlots:
        prepared.expectedReachableBodySlots,
      expectedReachableIvBase64Urls:
        prepared.expectedReachableIvBase64Urls,
    };
    this.pendingClearIntent = pending;
    await this.writePendingClearIntent(pending);
  }

  private async reconcilePendingClearIntent(): Promise<
    "base" | "committed"
  > {
    const pending = this.pendingClearIntent;
    if (!pending) {
      throw new Error("No pending ledger file clear intent");
    }
    let readText: Uint8Array;
    try {
      readText = (await this.adapter.readBinary(this.handle)).bytes;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not reconcile the previous ledger file clear intent",
        error,
      );
    }
    if (sameBytes(readText, pending.serializedFile)) {
      this.acceptVerified(
        await verifySerializedLedgerFile(
          readText,
          this.crypto,
          expectedFromPending(pending),
        ),
      );
      this.pendingClearIntent = null;
      return "committed";
    }
    if (!sameBytes(readText, pending.baseSerializedFile)) {
      throw externalChangeError(
        "Ledger file changed while retrying a clear",
      );
    }
    await verifyLedgerFile(
      parseAndValidateLedgerFile(readText),
      this.crypto,
      undefined,
      readText,
    );
    return "base";
  }

  private async writePendingClearIntent(
    pending: PendingClearIntent,
  ): Promise<void> {
    await this.assertDiskMatchesVerified();
    let readback: Uint8Array;
    try {
      readback = await writePreparedLedgerFile(
        this.adapter,
        this.handle,
        pending,
      );
    } catch (error) {
      throw mapAdapterWriteError(error);
    }
    this.acceptVerified(
      await verifySerializedLedgerFile(
        readback,
        this.crypto,
        expectedFromPending(pending),
      ),
    );
    if (this.pendingClearIntent === pending) {
      this.pendingClearIntent = null;
    }
  }

  private async reconcilePendingIntent(): Promise<"base" | "committed"> {
    const pending = this.pendingIntent;
    if (!pending) {
      throw new Error("No pending ledger file save intent");
    }

    let readText: Uint8Array;
    try {
      readText = (await this.adapter.readBinary(this.handle)).bytes;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not reconcile the previous ledger file save intent",
        error,
      );
    }

    if (sameBytes(readText, pending.serializedFile)) {
      const diskFile = parseAndValidateLedgerFile(readText);
      const verified = await verifyLedgerFile(
        diskFile,
        this.crypto,
        expectedFromPending(pending),
        readText,
      );
      this.acceptVerified(verified, pending.appendedFactId);
      this.pendingIntent = null;
      return "committed";
    }

    if (!sameBytes(readText, pending.baseSerializedFile)) {
      throw externalChangeError(
        "Ledger file changed while retrying a save",
      );
    }

    const diskFile = parseAndValidateLedgerFile(readText);
    await verifyLedgerFile(diskFile, this.crypto, undefined, readText);
    return "base";
  }

  private async writePendingIntent(
    pending: PendingSaveIntent,
  ): Promise<void> {
    let readback: Uint8Array;
    try {
      readback = await writePreparedLedgerFile(
        this.adapter,
        this.handle,
        pending,
      );
    } catch (error) {
      throw mapAdapterWriteError(error);
    }

    let verified: VerifiedLedgerFile;
    try {
      verified = await verifySerializedLedgerFile(
        readback,
        this.crypto,
        expectedFromPending(pending),
      );
    } catch (error) {
      if (error instanceof LedgerFileRepositoryError) {
        throw error;
      }
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Ledger file readback did not match the save intent",
        error,
      );
    }

    this.acceptVerified(verified, pending.appendedFactId);
    if (this.pendingIntent === pending) {
      this.pendingIntent = null;
    }
  }

  private async assertDiskMatchesVerified(
    reauthenticate = true,
  ): Promise<void> {
    let readText: Uint8Array;
    try {
      readText = (await this.adapter.readBinary(this.handle)).bytes;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not re-read the ledger file before saving",
        error,
      );
    }

    if (!sameBytes(readText, this.verified.serializedFile)) {
      throw externalChangeError(
        "Ledger file changed outside the current session",
      );
    }
    if (!reauthenticate) return;

    const diskFile = parseAndValidateLedgerFile(readText);
    try {
      await verifyLedgerFile(
        diskFile,
        this.crypto,
        undefined,
        readText,
      );
    } catch (error) {
      throw externalChangeError(
        "Ledger file no longer matches the verified session baseline",
        error,
      );
    }
  }
}

export class LedgerFileRecoveryCandidate {
  private pendingIntent: PendingRecoveryIntent | null = null;
  private confirmationPromise: Promise<LedgerFileRepository> | null =
    null;
  private recoveredRepository: LedgerFileRepository | null = null;
  private cancelled = false;

  constructor(
    private readonly adapter: LedgerFileHandleAdapter,
    private readonly handle: LedgerFileHandle,
    private readonly crypto: LedgerFileCrypto,
    private readonly physicalBaseFile: LedgerFileV3S3,
    private readonly serializedBaseline: Uint8Array,
    private readonly reachableBodySlots: readonly number[],
    private readonly reachableIvBase64Urls: readonly string[],
    private readonly verifiedRecoverySource: VerifiedGeneration,
    private readonly sessionLease: LedgerFileSessionLease,
    private readonly generateId: () => string,
    private readonly now: () => Date,
  ) {}

  confirm(): Promise<LedgerFileRepository> {
    if (this.recoveredRepository) {
      return Promise.resolve(this.recoveredRepository);
    }
    if (this.cancelled) {
      return Promise.reject(
        new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
          "Ledger file recovery candidate is no longer active",
        ),
      );
    }
    if (this.confirmationPromise) {
      return this.confirmationPromise;
    }

    const confirmation = this.sessionLease
      .runExclusiveWrite(() => this.confirmExclusive())
      .then((repository) => {
        this.recoveredRepository = repository;
        return repository;
      });
    this.confirmationPromise = confirmation.finally(() => {
      if (!this.recoveredRepository) {
        this.confirmationPromise = null;
      }
    });
    return this.confirmationPromise;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    await this.sessionLease.release();
  }

  private async confirmExclusive(): Promise<LedgerFileRepository> {
    if (this.cancelled) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        "Ledger file recovery candidate was cancelled",
      );
    }

    const diskText = await this.readForRecovery();
    if (
      this.pendingIntent &&
      sameBytes(diskText, this.pendingIntent.serializedFile)
    ) {
      const verified = await verifySerializedLedgerFile(
          diskText,
          this.crypto,
          expectedFromRecovery(
            this.pendingIntent,
            this.verifiedRecoverySource.generation,
            this.verifiedRecoverySource,
          ),
      );
      return this.createRepository(verified);
    }
    if (!sameBytes(diskText, this.serializedBaseline)) {
      throw externalChangeError(
        "Ledger file changed after recovery was offered",
      );
    }

    if (!this.pendingIntent) {
      const payloadResult = createCanonicalLedgerPayloadV4(
        this.verifiedRecoverySource.payload.ledgerData,
        this.now().toISOString(),
      );
      if (!payloadResult.ok) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
          "Verified previous generation could not form a recovery payload",
          payloadResult.errors,
        );
      }
      const revisionId = this.generateId();
      if (
        revisionId === this.physicalBaseFile.current.revisionId ||
        revisionId === this.physicalBaseFile.previous?.revisionId
      ) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
          "Revision generator returned an existing recovery revision",
        );
      }
      const prepared = await prepareNextLedgerFileV3S3(
        this.crypto,
        this.physicalBaseFile,
        this.serializedBaseline,
        this.reachableBodySlots,
        this.verifiedRecoverySource,
        payloadResult.value,
        revisionId,
        this.reachableIvBase64Urls,
      );
      this.pendingIntent = {
        file: prepared.file,
        serializedFile: prepared.serializedFile,
        writeMode: prepared.mode,
        patches: prepared.patches,
        expectedCurrent: payloadResult.value,
        expectedCurrentBlockPayloads:
          prepared.expectedCurrentBlockPayloads,
        expectedReachableBodySlots:
          prepared.expectedReachableBodySlots,
        expectedReachableIvBase64Urls:
          prepared.expectedReachableIvBase64Urls,
      };
    }

    if (this.cancelled) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        "Ledger file recovery candidate was cancelled before writing",
      );
    }

    let readback: Uint8Array;
    try {
      readback = await writePreparedLedgerFile(
        this.adapter,
        this.handle,
        this.pendingIntent,
      );
    } catch (error) {
      throw mapAdapterWriteError(error);
    }
    const verified = await verifySerializedLedgerFile(
      readback,
      this.crypto,
      expectedFromRecovery(
        this.pendingIntent,
        this.verifiedRecoverySource.generation,
        this.verifiedRecoverySource,
      ),
    );
    return this.createRepository(verified);
  }

  private async readForRecovery(): Promise<Uint8Array> {
    try {
      return (await this.adapter.readBinary(this.handle)).bytes;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not re-read the ledger file before recovery",
        error,
      );
    }
  }

  private createRepository(
    verified: VerifiedLedgerFile,
  ): LedgerFileRepository {
    return LedgerFileRepository.fromRecoveredState(
      this.adapter,
      this.handle,
      this.crypto,
      verified,
      this.sessionLease,
      this.generateId,
      this.now,
    );
  }
}

export async function inspectLedgerFile(
  adapter: LedgerFileHandleAdapter,
  handle: LedgerFileHandle,
): Promise<LedgerFileV3S3> {
  const read = await adapter.readBinary(handle);
  return parseAndValidateLedgerFile(read.bytes);
}
