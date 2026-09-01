import {
  LedgerFileAdapterError,
  type LedgerFileHandle,
  type LedgerFileHandleAdapter,
} from "./ledgerFileHandleAdapter";
import { byteArraysEqual } from "./byteArraysEqual";
import {
  createCanonicalLedgerPayloadV4,
  evaluateLedgerFilePayloadByteLength,
  type CanonicalLedgerPayloadV4,
  type DecryptedLedgerPayloadV4,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
} from "./ledgerFileContract";
import {
  isLedgerFileV3S3Bytes,
  ledgerFileBodySlotsRequiredV3S3,
  LEDGER_FILE_OUTER_V3_S3_CONSTANTS,
  LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
  otherLedgerFileHeaderSlotV3S3,
  parseLedgerFileV3S3Candidates,
  prepareLedgerFileUpdateV3S3,
  RECORDS_PER_LEDGER_BLOCK,
  serializeLedgerFileV3S3,
  type EncryptedLedgerBlockV3S3,
  type LedgerFileBinaryPatchV3S3,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
  validateLedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  createLedgerGenerationPlanV3S3,
  mergeBlockPayloadsV3S3,
  parseLedgerBlockPayloadV3S3,
  type LedgerBlockPayloadV3S3,
  type LedgerGenerationPlanV3S3,
} from "./ledgerFileChunkingV3";
import type { LedgerFileSessionLease } from "./ledgerFileSessionLease";
import { createLedgerDataContentIdentity } from "@/platform/persistence";
import { LedgerFileCrypto } from "./ledgerFileCrypto";
import type { CryptoProvider } from "@/platform/encryption";
import type { LedgerData, Trade } from "@/core/models";
import { evaluateLedgerResourcePolicyAfterTradeAppend } from "@/core/validation";
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

export const LEDGER_FILE_REPOSITORY_ERROR_CODES = {
  INVALID_CANDIDATE: "LEDGER_FILE_INVALID_CANDIDATE",
  INVALID_FILE: "LEDGER_FILE_INVALID_FILE",
  AUTHENTICATION_FAILED: "LEDGER_FILE_AUTHENTICATION_FAILED",
  FILE_ID_MISMATCH: "LEDGER_FILE_ID_MISMATCH",
  REVISION_MISMATCH: "LEDGER_FILE_REVISION_MISMATCH",
  EXTERNAL_CHANGE: "LEDGER_FILE_EXTERNAL_CHANGE",
  WRITE_FAILED: "LEDGER_FILE_WRITE_FAILED",
  READBACK_FAILED: "LEDGER_FILE_READBACK_FAILED",
  CLEAR_UNSUPPORTED: "LEDGER_FILE_CLEAR_UNSUPPORTED",
  CLEAR_AUTHORIZATION_FAILED:
    "LEDGER_FILE_CLEAR_AUTHORIZATION_FAILED",
  IMPORT_AUTHORIZATION_FAILED:
    "LEDGER_FILE_IMPORT_AUTHORIZATION_FAILED",
  IMPORT_FAILED_BASE_RESTORED:
    "LEDGER_FILE_IMPORT_FAILED_BASE_RESTORED",
  IMPORT_RECOVERY_BLOCKED:
    "LEDGER_FILE_IMPORT_RECOVERY_BLOCKED",
} as const;

export type LedgerFileRepositoryErrorCode =
  (typeof LEDGER_FILE_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_FILE_REPOSITORY_ERROR_CODES];

export class LedgerFileRepositoryError extends Error {
  constructor(
    readonly code: LedgerFileRepositoryErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerFileRepositoryError";
  }
}

export type LedgerFileRepositoryDependencies = {
  cryptoProvider?: CryptoProvider;
  generateId?: () => string;
  now?: () => Date;
};

export type LedgerFileRepositorySessionDependencies =
  LedgerFileRepositoryDependencies & {
    sessionLease: LedgerFileSessionLease;
  };

type VerifiedGeneration = {
  generation: LedgerGenerationV3S3;
  payload: DecryptedLedgerPayloadV4;
  serializedPayload: string;
  serializedLedgerData: string;
  blockPayloads: ReadonlyMap<string, LedgerBlockPayloadV3S3>;
};

type VerifiedLedgerFile = {
  file: LedgerFileV3S3;
  current: VerifiedGeneration;
  previous: VerifiedGeneration | null;
  serializedFile: Uint8Array;
  reachableBodySlots: readonly number[];
  reachableIvBase64Urls: readonly string[];
};

type PendingSaveIntent = {
  key: string;
  baseFile: LedgerFileV3S3;
  baseSerializedFile: Uint8Array;
  baseCurrent: VerifiedGeneration;
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  writeMode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
  expectedCurrent: CanonicalLedgerPayloadV4;
  expectedCurrentBlockPayloads: ReadonlyMap<string, string>;
  expectedReachableBodySlots: readonly number[];
  expectedReachableIvBase64Urls: readonly string[];
  appendedFactId?: string;
};

type PendingRecoveryIntent = {
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  writeMode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
  expectedCurrent: CanonicalLedgerPayloadV4;
  expectedCurrentBlockPayloads: ReadonlyMap<string, string>;
  expectedReachableBodySlots: readonly number[];
  expectedReachableIvBase64Urls: readonly string[];
};

type PendingClearIntent = PendingSaveIntent & {
  authorization: ReadyLedgerClearAuthorization;
};

type PendingImportIntent = PendingSaveIntent & {
  authorization: ReadyLedgerImportAuthorization;
};

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

type PreparedLedgerFileWrite = Pick<
  PendingRecoveryIntent,
  "serializedFile" | "writeMode" | "patches"
>;

async function writePreparedLedgerFile(
  adapter: LedgerFileHandleAdapter,
  handle: LedgerFileHandle,
  prepared: PreparedLedgerFileWrite,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const readback = prepared.writeMode === "patch"
    ? await adapter.writeBinaryPatchesAndReadBack(
        handle,
        prepared.patches,
        prepared.serializedFile.byteLength,
        signal,
      )
    : await adapter.writeBinaryAndReadBack(
        handle,
        prepared.serializedFile,
        signal,
      );
  return readback.bytes;
}

async function createInitialLedgerFileV3S3(
  crypto: LedgerFileCrypto,
  fileId: string,
  revision: {
    revisionId: string;
    parentRevisionId: null;
  },
  payload: CanonicalLedgerPayloadV4,
): Promise<LedgerFileV3S3> {
  const plan = createLedgerGenerationPlanV3S3(
    revision.revisionId,
    payload,
  );
  const requiredSlots = generationPlanRequiredSlots(plan);
  const bodySlotCount = requiredSlots + ordinaryRewriteSlotReserve(plan);
  const allocator = createBodySlotAllocator(
    Array.from({ length: bodySlotCount }, (_, slot) => slot),
  );
  const usedIvBase64Urls = new Set<string>();
  const current = await encryptGenerationPlanV3S3(
    crypto,
    fileId,
    revision,
    plan,
    allocator,
    `${revision.revisionId}:control`,
    usedIvBase64Urls,
  );
  return sealLedgerFileManifestV3S3(crypto, {
    fileFormatVersion: LEDGER_FILE_OUTER_V3_S3_CONSTANTS.fileFormatVersion,
    cryptoVersion: LEDGER_FILE_OUTER_V3_S3_CONSTANTS.cryptoVersion,
    ledgerSchemaVersion:
      LEDGER_FILE_OUTER_V3_S3_CONSTANTS.ledgerSchemaVersion,
    backupFormatVersion:
      LEDGER_FILE_OUTER_V3_S3_CONSTANTS.backupFormatVersion,
    fileId,
    sequence: 1,
    activeHeaderSlot: 0,
    recordsPerBlock: RECORDS_PER_LEDGER_BLOCK,
    bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
    bodySlotCount,
    crypto: crypto.getCryptoMetadata(),
    manifestAuthIvBase64Url: crypto.createIvBase64UrlV3S3(
      usedIvBase64Urls,
    ),
    manifestAuthTagBytes: new Uint8Array(16),
    current,
    previous: null,
  });
}

async function prepareNextLedgerFileV3S3(
  crypto: LedgerFileCrypto,
  physicalBaseFile: LedgerFileV3S3,
  baseSerializedFile: Uint8Array,
  reachableBodySlots: readonly number[],
  logicalBase: VerifiedGeneration,
  payload: CanonicalLedgerPayloadV4,
  revisionId: string,
  reachableIvBase64Urls?: readonly string[],
  action?: LedgerAction,
) {
  const plan = createLedgerGenerationPlanV3S3(
    revisionId,
    payload,
    {
      generation: logicalBase.generation,
      blockPayloads: logicalBase.blockPayloads,
    },
    action,
  );
  const initialFree = Array.from(
    { length: physicalBaseFile.bodySlotCount },
    (_, slot) => slot,
  ).filter((slot) => !reachableBodySlots.includes(slot));
  const requiredSlots = generationPlanRequiredSlots(plan);
  const reserveSlots = 2 * ordinaryRewriteSlotReserve(plan);
  let bodySlotCount = physicalBaseFile.bodySlotCount;
  const free = [...initialFree];
  if (free.length < requiredSlots) {
    const added = requiredSlots - free.length + reserveSlots;
    free.push(
      ...Array.from(
        { length: added },
        (_, index) => physicalBaseFile.bodySlotCount + index,
      ),
    );
    bodySlotCount += added;
  }
  const allocator = createBodySlotAllocator(free);
  const usedIvBase64Urls = new Set(
    reachableIvBase64Urls ??
      readReachableIvBase64UrlsV3S3(baseSerializedFile),
  );
  const current = await encryptGenerationPlanV3S3(
    crypto,
    physicalBaseFile.fileId,
    {
      revisionId,
      parentRevisionId: logicalBase.generation.revisionId,
    },
    plan,
    allocator,
    logicalBase.generation.controlBlock.blockId,
    usedIvBase64Urls,
  );
  const nextFile = await sealLedgerFileManifestV3S3(crypto, {
    fileFormatVersion: physicalBaseFile.fileFormatVersion,
    cryptoVersion: physicalBaseFile.cryptoVersion,
    ledgerSchemaVersion: physicalBaseFile.ledgerSchemaVersion,
    backupFormatVersion: physicalBaseFile.backupFormatVersion,
    fileId: physicalBaseFile.fileId,
    sequence: physicalBaseFile.sequence + 1,
    activeHeaderSlot: otherLedgerFileHeaderSlotV3S3(
      physicalBaseFile.activeHeaderSlot,
    ),
    recordsPerBlock: RECORDS_PER_LEDGER_BLOCK,
    bodySlotBytes: LEDGER_FILE_V3_S3_BODY_SLOT_BYTES,
    bodySlotCount,
    crypto: physicalBaseFile.crypto,
    manifestAuthIvBase64Url: crypto.createIvBase64UrlV3S3(
      usedIvBase64Urls,
    ),
    manifestAuthTagBytes: new Uint8Array(16),
    current,
    previous: logicalBase.generation,
  });
  return {
    ...prepareLedgerFileUpdateV3S3(
    physicalBaseFile,
    baseSerializedFile,
    nextFile,
    ),
    expectedCurrentBlockPayloads: new Map<string, string>([
      [current.controlBlock.blockId, plan.controlSerializedPayload],
      ...plan.factBlocks.flatMap((block) =>
        block.serializedPayload === null
          ? []
          : [[block.blockId, block.serializedPayload] as const],
      ),
    ]),
    expectedReachableBodySlots: Array.from(
      new Set([
        ...reachableBodySlots,
        ...collectLedgerFileBodySlots(nextFile),
      ]),
    ).sort((left, right) => left - right),
    expectedReachableIvBase64Urls: Array.from(
      new Set([
        ...usedIvBase64Urls,
        nextFile.manifestAuthIvBase64Url,
      ]),
    ),
  };
}

function collectLedgerFileBodySlots(file: LedgerFileV3S3): number[] {
  return [file.current, file.previous]
    .flatMap((generation) =>
      generation
        ? [generation.controlBlock, ...generation.factBlocks]
        : [],
    )
    .flatMap((block) => block.bodySlots);
}

function collectLedgerFileIvBase64Urls(
  files: readonly LedgerFileV3S3[],
): string[] {
  const ivs = new Set<string>();
  for (const file of files) {
    ivs.add(file.manifestAuthIvBase64Url);
    for (const generation of [file.current, file.previous]) {
      if (!generation) continue;
      for (const block of [
        generation.controlBlock,
        ...generation.factBlocks,
      ]) {
        ivs.add(block.ivBase64Url);
      }
    }
  }
  return [...ivs];
}

async function encryptGenerationPlanV3S3(
  crypto: LedgerFileCrypto,
  fileId: string,
  revision: {
    revisionId: string;
    parentRevisionId: string | null;
  },
  plan: LedgerGenerationPlanV3S3,
  allocate: (count: number) => number[],
  controlBlockId: string,
  usedIvBase64Urls: Set<string>,
): Promise<LedgerGenerationV3S3> {
  const controlPlaintextBytes = new TextEncoder().encode(
    plan.controlSerializedPayload,
  ).byteLength;
  const controlBlock = await crypto.encryptBlockV3S3(
    fileId,
    {
      blockId: controlBlockId,
      role: "control",
      order: 0,
      sealed: true,
      recordCount: 0,
      ledgerSchemaVersion: SUPPORTED_LEDGER_SCHEMA_VERSION,
      plaintextByteLength: controlPlaintextBytes,
      bodySlots: allocate(
        ledgerFileBodySlotsRequiredV3S3(controlPlaintextBytes + 16),
      ),
    },
    plan.controlSerializedPayload,
    usedIvBase64Urls,
  );
  usedIvBase64Urls.add(controlBlock.ivBase64Url);
  const factBlocks: EncryptedLedgerBlockV3S3[] = [];
  for (const block of plan.factBlocks) {
    if (block.reusedBlock) {
      factBlocks.push(block.reusedBlock);
      continue;
    }
    if (block.serializedPayload === null) {
      throw new Error(
        `Changed V3 S-3 block ${block.blockId} has no plaintext`,
      );
    }
    const plaintextByteLength = new TextEncoder().encode(
      block.serializedPayload,
    ).byteLength;
    const encrypted = await crypto.encryptBlockV3S3(
        fileId,
        {
          blockId: block.blockId,
          role: "facts",
          order: block.order,
          sealed: block.sealed,
          recordCount: block.recordCount,
          ledgerSchemaVersion: SUPPORTED_LEDGER_SCHEMA_VERSION,
          plaintextByteLength,
          bodySlots: allocate(
            ledgerFileBodySlotsRequiredV3S3(plaintextByteLength + 16),
          ),
        },
        block.serializedPayload,
        usedIvBase64Urls,
      );
    usedIvBase64Urls.add(encrypted.ivBase64Url);
    factBlocks.push(encrypted);
  }
  return {
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    controlBlock,
    factBlocks,
    openBlockId: plan.openBlockId,
  };
}

async function sealLedgerFileManifestV3S3(
  crypto: LedgerFileCrypto,
  file: LedgerFileV3S3,
): Promise<LedgerFileV3S3> {
  const manifestAuthTagBytes = await crypto.authenticateManifestV3S3(file);
  return { ...file, manifestAuthTagBytes };
}

function generationPlanRequiredSlots(
  plan: LedgerGenerationPlanV3S3,
): number {
  const controlBytes = new TextEncoder().encode(
    plan.controlSerializedPayload,
  ).byteLength;
  return (
    ledgerFileBodySlotsRequiredV3S3(controlBytes + 16) +
    plan.factBlocks.reduce((total, block) => {
      if (block.reusedBlock) return total;
      if (block.serializedPayload === null) {
        throw new Error(
          `Changed V3 S-3 block ${block.blockId} has no plaintext`,
        );
      }
      const bytes = new TextEncoder().encode(block.serializedPayload).byteLength;
      return total + ledgerFileBodySlotsRequiredV3S3(bytes + 16);
    }, 0)
  );
}

function ordinaryRewriteSlotReserve(
  plan: LedgerGenerationPlanV3S3,
): number {
  const controlBytes = new TextEncoder().encode(
    plan.controlSerializedPayload,
  ).byteLength;
  const controlSlots = ledgerFileBodySlotsRequiredV3S3(controlBytes + 16);
  const maximumFactSlots = Math.max(
    1,
    ...plan.factBlocks.map((block) => {
      if (block.serializedPayload === null) {
        return block.reusedBlock?.bodySlots.length ?? 1;
      }
      const bytes = new TextEncoder().encode(block.serializedPayload).byteLength;
      return ledgerFileBodySlotsRequiredV3S3(bytes + 16);
    }),
  );
  return controlSlots + maximumFactSlots;
}

function createBodySlotAllocator(
  available: number[],
): (count: number) => number[] {
  const remaining = [...available].sort((left, right) => left - right);
  return (count) => {
    if (remaining.length < count) {
      throw new Error("V3 S-3 file has no safe body slots for this write");
    }
    return remaining.splice(0, count);
  };
}

function readReachableBodySlotsV3S3(bytes: Uint8Array): number[] {
  const parsed = parseLedgerFileV3S3Candidates(bytes);
  if (!parsed.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file body-slot reachability could not be established",
      parsed.errors,
    );
  }
  return parsed.value.reachableBodySlots;
}

function readReachableIvBase64UrlsV3S3(bytes: Uint8Array): string[] {
  const parsed = parseLedgerFileV3S3Candidates(bytes);
  if (!parsed.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file IV reachability could not be established",
      parsed.errors,
    );
  }
  return collectLedgerFileIvBase64Urls(
    parsed.value.candidates.map(({ file }) => file),
  );
}

export async function inspectLedgerFile(
  adapter: LedgerFileHandleAdapter,
  handle: LedgerFileHandle,
): Promise<LedgerFileV3S3> {
  const read = await adapter.readBinary(handle);
  return parseAndValidateLedgerFile(read.bytes);
}

function expectedFromPending(pending: PendingSaveIntent) {
  return {
    file: pending.file,
    fileId: pending.file.fileId,
    currentRevisionId: pending.file.current.revisionId,
    currentParentRevisionId:
      pending.baseFile.current.revisionId,
    currentGeneration: pending.file.current,
    currentPayload: pending.expectedCurrent,
    currentBlockSerializedPayloads:
      pending.expectedCurrentBlockPayloads,
    reachableBodySlots: pending.expectedReachableBodySlots,
    reachableIvBase64Urls:
      pending.expectedReachableIvBase64Urls,
    previousGeneration: pending.baseFile.current,
    previousPayload: pending.baseCurrent,
    serializedFile: pending.serializedFile,
  };
}

function expectedFromRecovery(
  pending: PendingRecoveryIntent,
  previousGeneration: LedgerGenerationV3S3,
  previousPayload: VerifiedGeneration,
): VerificationExpectation {
  return {
    file: pending.file,
    fileId: pending.file.fileId,
    currentRevisionId: pending.file.current.revisionId,
    currentParentRevisionId: previousGeneration.revisionId,
    currentGeneration: pending.file.current,
    currentPayload: pending.expectedCurrent,
    currentBlockSerializedPayloads:
      pending.expectedCurrentBlockPayloads,
    reachableBodySlots: pending.expectedReachableBodySlots,
    reachableIvBase64Urls:
      pending.expectedReachableIvBase64Urls,
    previousGeneration,
    previousPayload,
    serializedFile: pending.serializedFile,
  };
}

async function verifySerializedLedgerFile(
  serialized: Uint8Array,
  crypto: LedgerFileCrypto,
  expected?: VerificationExpectation,
): Promise<VerifiedLedgerFile> {
  const exactExpectedBytes =
    expected !== undefined &&
    sameBytes(serialized, expected.serializedFile);
  return verifyLedgerFile(
    exactExpectedBytes
      ? expected.file
      : parseAndValidateLedgerFile(serialized),
    crypto,
    expected,
    serialized,
    exactExpectedBytes,
  );
}

type VerificationExpectation = {
  file: LedgerFileV3S3;
  fileId: string;
  currentRevisionId: string;
  currentParentRevisionId: string | null;
  currentGeneration: LedgerGenerationV3S3;
  currentPayload: CanonicalLedgerPayloadV4;
  currentBlockSerializedPayloads: ReadonlyMap<string, string> | null;
  reachableBodySlots?: readonly number[];
  reachableIvBase64Urls?: readonly string[];
  previousGeneration: LedgerGenerationV3S3 | null;
  previousPayload: VerifiedGeneration | null;
  serializedFile: Uint8Array;
};

async function verifyLedgerFile(
  file: LedgerFileV3S3,
  crypto: LedgerFileCrypto,
  expected?: VerificationExpectation,
  serializedFile = serializeLedgerFile(file),
  exactExpectedBytes = false,
): Promise<VerifiedLedgerFile> {
  if (!crypto.matchesCryptoMetadata(file.crypto)) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file crypto metadata does not match the bound session",
    );
  }

  if (expected && file.fileId !== expected.fileId) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
      "Readback fileId does not match the bound ledger file",
    );
  }

  try {
    await crypto.verifyManifestV3S3(file);
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file manifest could not be authenticated",
      error,
    );
  }

  let current: VerifiedGeneration | null = null;
  let previous: VerifiedGeneration | null = null;
  let currentError: unknown;
  let previousError: unknown;

  try {
    current = await verifyGeneration(
      file,
      file.current,
      crypto,
      expected?.previousPayload ?? undefined,
      expected?.currentBlockSerializedPayloads ?? undefined,
      expected?.currentPayload,
    );
  } catch (error) {
    currentError = error;
  }

  if (file.previous) {
    if (
      expected?.previousGeneration &&
      expected.previousPayload &&
      sameGeneration(file.previous, expected.previousGeneration)
    ) {
      previous = {
        ...expected.previousPayload,
        generation: file.previous,
      };
    } else {
      try {
        previous = await verifyGeneration(file, file.previous, crypto);
      } catch (error) {
        previousError = error;
      }
    }
  }

  if (!current) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Current ledger file generation could not be authenticated and validated",
      currentError,
    );
  }

  if (file.previous && !previous) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Previous ledger file generation could not be authenticated and validated",
      previousError,
    );
  }

  if (expected) {
    if (
      file.current.revisionId !== expected.currentRevisionId ||
      file.current.parentRevisionId !==
        expected.currentParentRevisionId
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.REVISION_MISMATCH,
        "Readback current revision does not match the save intent",
      );
    }

    if (!sameGeneration(file.current, expected.currentGeneration)) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Readback current generation does not match the exact encrypted save intent",
      );
    }

    if (
      current.serializedPayload !==
        expected.currentPayload.serializedPayload ||
      current.serializedLedgerData !==
        expected.currentPayload.serializedLedgerData
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Readback current payload does not match the save intent",
      );
    }

    if (expected.previousGeneration === null) {
      if (file.previous !== null || previous !== null) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.REVISION_MISMATCH,
          "Initial ledger file readback unexpectedly contains a previous generation",
        );
      }
    } else if (
      file.previous === null ||
      previous === null ||
      !sameGeneration(file.previous, expected.previousGeneration) ||
      previous.serializedPayload !==
        expected.previousPayload?.serializedPayload ||
      previous.serializedLedgerData !==
        expected.previousPayload.serializedLedgerData
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Readback previous generation is not the unchanged verified base",
      );
    }

    if (
      !exactExpectedBytes &&
      !sameBytes(serializedFile, expected.serializedFile)
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Ledger file readback did not match the exact prepared bytes",
      );
    }
  }

  return {
    file,
    current,
    previous,
    serializedFile,
    reachableBodySlots:
      expected?.reachableBodySlots ??
      readReachableBodySlotsV3S3(serializedFile),
    reachableIvBase64Urls:
      expected?.reachableIvBase64Urls ??
      readReachableIvBase64UrlsV3S3(serializedFile),
  };
}

async function verifyLedgerFileForOpen(
  file: LedgerFileV3S3,
  serializedFile: Uint8Array,
  crypto: LedgerFileCrypto,
  reachableBodySlots: readonly number[],
  reachableIvBase64Urls: readonly string[],
): Promise<
  | { status: "verified"; verified: VerifiedLedgerFile }
  | {
      status: "recovery-required";
      previous: VerifiedGeneration;
    }
> {
  if (!crypto.matchesCryptoMetadata(file.crypto)) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file crypto metadata does not match the unlock attempt",
    );
  }

  try {
    await crypto.verifyManifestV3S3(file);
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file manifest could not be authenticated",
      error,
    );
  }

  let current: VerifiedGeneration | null = null;
  let previous: VerifiedGeneration | null = null;
  let currentError: unknown;
  let previousError: unknown;

  try {
    current = await verifyGeneration(file, file.current, crypto);
  } catch (error) {
    currentError = error;
  }
  if (file.previous) {
    try {
      previous = await verifyGeneration(file, file.previous, crypto);
    } catch (error) {
      previousError = error;
    }
  }

  if (!current) {
    if (file.previous && previous) {
      return { status: "recovery-required", previous };
    }
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file generations could not be authenticated and validated",
      currentError ?? previousError,
    );
  }
  if (file.previous && !previous) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
      "Ledger file generations could not be authenticated and validated",
      previousError,
    );
  }

  return {
    status: "verified",
    verified: {
      file,
      current,
      previous,
      serializedFile,
      reachableBodySlots,
      reachableIvBase64Urls,
    },
  };
}

async function verifyGeneration(
  file: LedgerFileV3S3,
  generation: LedgerGenerationV3S3,
  crypto: LedgerFileCrypto,
  trusted?: VerifiedGeneration,
  expectedBlockSerializedPayloads?: ReadonlyMap<string, string>,
  expectedPayload?: CanonicalLedgerPayloadV4,
): Promise<VerifiedGeneration> {
  try {
    const generationBlockIds = new Set(
      [generation.controlBlock, ...generation.factBlocks].map(
        (block) => block.blockId,
      ),
    );
    if (
      expectedBlockSerializedPayloads &&
      [...expectedBlockSerializedPayloads.keys()].some(
        (blockId) => !generationBlockIds.has(blockId),
      )
    ) {
      throw new Error(
        "Expected V3 S-3 block payload is outside the generation",
      );
    }
    const blockPayloads = new Map<string, LedgerBlockPayloadV3S3>();
    const control = await readVerifiedBlockPayload(
      file,
      generation.controlBlock,
      crypto,
      trusted,
      expectedBlockSerializedPayloads?.get(
        generation.controlBlock.blockId,
      ),
      expectedBlockSerializedPayloads !== undefined,
    );
    blockPayloads.set(generation.controlBlock.blockId, control);
    const factPayloads: LedgerBlockPayloadV3S3[] = [];
    for (const block of generation.factBlocks) {
      const payload = await readVerifiedBlockPayload(
        file,
        block,
        crypto,
        trusted,
        expectedBlockSerializedPayloads?.get(block.blockId),
        expectedBlockSerializedPayloads !== undefined,
      );
      blockPayloads.set(block.blockId, payload);
      factPayloads.push(payload);
    }
    const payloadResult = expectedPayload ??
      mergeBlockPayloadsV3S3(control, factPayloads);
    return {
      generation,
      payload: payloadResult.value,
      serializedPayload: payloadResult.serializedPayload,
      serializedLedgerData: payloadResult.serializedLedgerData,
      blockPayloads,
    };
  } catch (error) {
    if (error instanceof LedgerFileRepositoryError) throw error;
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Decrypted ledger blocks could not be authenticated and merged",
      error,
    );
  }
}

async function readVerifiedBlockPayload(
  file: LedgerFileV3S3,
  block: EncryptedLedgerBlockV3S3,
  crypto: LedgerFileCrypto,
  trusted?: VerifiedGeneration,
  expectedSerializedPayload?: string,
  expectedPayloadsProvided = false,
): Promise<LedgerBlockPayloadV3S3> {
  const trustedBlock = trusted
    ? [
        trusted.generation.controlBlock,
        ...trusted.generation.factBlocks,
      ].find((candidate) =>
        candidate.blockId === block.blockId &&
        sameEncryptedBlock(candidate, block),
      )
    : undefined;
  const trustedPayload = trustedBlock
    ? trusted?.blockPayloads.get(trustedBlock.blockId)
    : undefined;
  if (trustedPayload) {
    if (
      expectedSerializedPayload !== undefined &&
      JSON.stringify(trustedPayload) !== expectedSerializedPayload
    ) {
      throw new Error(
        `Trusted V3 S-3 block ${block.blockId} does not match the save plan`,
      );
    }
    return trustedPayload;
  }

  if (
    expectedPayloadsProvided &&
    expectedSerializedPayload === undefined
  ) {
    throw new Error(
      `Changed V3 S-3 block ${block.blockId} is missing from the save plan`,
    );
  }

  const plaintext = await crypto.decryptBlockV3S3(file.fileId, block);
  if (
    expectedSerializedPayload !== undefined &&
    plaintext !== expectedSerializedPayload
  ) {
    throw new Error(
      `Authenticated V3 S-3 block ${block.blockId} does not match the save plan`,
    );
  }
  return parseLedgerBlockPayloadV3S3(
    plaintext,
    block.role,
    block.recordCount,
  );
}

function parseAndValidateLedgerFile(
  serialized: Uint8Array,
): LedgerFileV3S3 {
  const selected = parseAndValidateLedgerFileCandidates(
    serialized,
  ).candidates.find(({ referencedPaddingIsZero }) =>
    referencedPaddingIsZero,
  );
  if (!selected) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file has no unique complete V3 S-3 header candidate",
    );
  }
  return selected.file;
}

function parseAndValidateLedgerFileCandidates(
  serialized: Uint8Array,
): {
  candidates: Array<{
    file: LedgerFileV3S3;
    referencedPaddingIsZero: boolean;
  }>;
  reachableBodySlots: number[];
} {
  if (!isLedgerFileV3S3Bytes(serialized)) {
    rejectUnsupportedJsonLedgerFile(serialized);
  }
  const parsed = parseLedgerFileV3S3Candidates(serialized);
  if (!parsed.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file failed the strict V3 S-3 chunked container contract",
      parsed.errors,
    );
  }
  const candidates = parsed.value.candidates
    .sort((left, right) => right.file.sequence - left.file.sequence);
  if (
    !candidates.some(({ referencedPaddingIsZero }) =>
      referencedPaddingIsZero,
    ) ||
    (candidates[1] && candidates[1].file.sequence === candidates[0]!.file.sequence)
  ) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file has no unique complete V3 S-3 header candidate",
    );
  }
  return {
    candidates,
    reachableBodySlots: parsed.value.reachableBodySlots,
  };
}

function assertValidLedgerFile(file: LedgerFileV3S3): void {
  const validation = validateLedgerFileV3S3(file);
  if (!validation.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Generated ledger file failed its own V3 S-3 contract",
      validation.errors,
    );
  }
}

function serializeLedgerFile(file: LedgerFileV3S3): Uint8Array {
  return serializeLedgerFileV3S3(file);
}

function rejectUnsupportedJsonLedgerFile(bytes: Uint8Array): never {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file is neither a V3 binary container nor valid legacy JSON",
      error,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file does not use the supported V3 container",
    );
  }

  const currentLedgerSchemaVersion = readPlaintextVersion(
    parsed,
    "current",
    "ledgerSchemaVersion",
  );
  const previousLedgerSchemaVersion = readPlaintextVersion(
    parsed,
    "previous",
    "ledgerSchemaVersion",
  );
  const retiredLedgerSchemaVersion = [
    currentLedgerSchemaVersion,
    previousLedgerSchemaVersion,
  ].find(
    (version): version is number =>
      typeof version === "number" &&
      version !== SUPPORTED_LEDGER_SCHEMA_VERSION,
  );
  if (retiredLedgerSchemaVersion !== undefined) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file uses an unsupported ledger schema",
      [
        {
          code: "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
          path: "current.ledgerSchemaVersion",
          message:
            retiredLedgerSchemaVersion === 2 ||
            retiredLedgerSchemaVersion === 3
              ? `This file contains a V${retiredLedgerSchemaVersion} ledger; V4 does not provide migration`
              : "The ledger schema version is unsupported",
        },
      ],
    );
  }

  const fileFormatVersion = readPlaintextVersion(
    parsed,
    "fileFormatVersion",
  );
  if (fileFormatVersion !== 2) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file does not use the supported V3 container",
      [
        {
          code: "LEDGER_FILE_UNSUPPORTED_VERSION",
          path: "fileFormatVersion",
          message: "Unsupported ledger file format version",
        },
      ],
    );
  }
  throw new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
    "Ledger file format V2 is retired and is not opened before migration is enabled",
    [
      {
        code: "LEDGER_FILE_UNSUPPORTED_VERSION",
        path: "fileFormatVersion",
        message: "Ledger file format V2 is retired",
      },
    ],
  );
}

function readPlaintextVersion(
  value: object,
  key: string,
): unknown;
function readPlaintextVersion(
  value: object,
  outerKey: string,
  innerKey: string,
): unknown;
function readPlaintextVersion(
  value: object,
  outerKey: string,
  innerKey?: string,
): unknown {
  if (!(outerKey in value)) return undefined;
  const outer = value[outerKey as keyof typeof value] as unknown;
  if (innerKey === undefined) return outer;
  if (typeof outer !== "object" || outer === null || !(innerKey in outer)) {
    return undefined;
  }
  return outer[innerKey as keyof typeof outer];
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return byteArraysEqual(left, right);
}

function retimeCanonicalLedgerPayloadV4(
  payload: CanonicalLedgerPayloadV4,
  savedAt: string,
): CanonicalLedgerPayloadV4 {
  const value = {
    savedAt,
    ledgerData: payload.value.ledgerData,
  };
  const serializedPayload = serializeCanonicalPayload(
    savedAt,
    payload.serializedLedgerData,
  );
  const byteResult = evaluateLedgerFilePayloadByteLength(
    serializedPayload,
  );
  if (!byteResult.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
      "Ledger data failed the file payload resource policy after retiming",
      byteResult.errors,
    );
  }
  return {
    value,
    serializedPayload,
    serializedLedgerData: payload.serializedLedgerData,
  };
}

function createCanonicalPayloadAfterBuyTrade(
  base: LedgerData,
  trade: Trade,
  savedAt: string,
): CanonicalLedgerPayloadV4 | null {
  const focused = createCanonicalLedgerPayloadV4(
    {
      schemaVersion: 4,
      assets: base.assets,
      trades: [trade],
      cashEvents: [],
      assetTransfers: [],
      priceSnapshots: [],
      feeRules: base.feeRules,
    },
    savedAt,
  );
  if (!focused.ok) return null;
  const validatedTrade = focused.value.value.ledgerData.trades[0];
  if (!validatedTrade) return null;

  const ledgerData: LedgerData = {
    schemaVersion: 4,
    assets: base.assets,
    trades: [...base.trades, validatedTrade],
    cashEvents: base.cashEvents,
    assetTransfers: base.assetTransfers,
    priceSnapshots: base.priceSnapshots,
    feeRules: base.feeRules,
  };
  const resourceResult =
    evaluateLedgerResourcePolicyAfterTradeAppend(
      ledgerData,
      validatedTrade,
    );
  if (!resourceResult.ok) return null;

  const value = { savedAt, ledgerData };
  const serializedLedgerData = JSON.stringify(ledgerData);
  const serializedPayload = serializeCanonicalPayload(
    savedAt,
    serializedLedgerData,
  );
  const byteResult = evaluateLedgerFilePayloadByteLength(
    serializedPayload,
  );
  if (!byteResult.ok) return null;
  return { value, serializedPayload, serializedLedgerData };
}

function collectLedgerFactIds(ledgerData: LedgerData): Set<string> {
  return new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
  );
}

function serializeCanonicalPayload(
  savedAt: string,
  serializedLedgerData: string,
): string {
  return `{"savedAt":${JSON.stringify(savedAt)},"ledgerData":${serializedLedgerData}}`;
}

function sameGeneration(
  left: LedgerGenerationV3S3,
  right: LedgerGenerationV3S3,
): boolean {
  return (
    left.revisionId === right.revisionId &&
    left.parentRevisionId === right.parentRevisionId &&
    left.openBlockId === right.openBlockId &&
    sameEncryptedBlock(left.controlBlock, right.controlBlock) &&
    left.factBlocks.length === right.factBlocks.length &&
    left.factBlocks.every((block, index) =>
      sameEncryptedBlock(block, right.factBlocks[index]!),
    )
  );
}

function sameEncryptedBlock(
  left: EncryptedLedgerBlockV3S3,
  right: EncryptedLedgerBlockV3S3,
): boolean {
  return (
    left.blockId === right.blockId &&
    left.role === right.role &&
    left.order === right.order &&
    left.sealed === right.sealed &&
    left.recordCount === right.recordCount &&
    left.ledgerSchemaVersion === right.ledgerSchemaVersion &&
    left.ivBase64Url === right.ivBase64Url &&
    left.plaintextByteLength === right.plaintextByteLength &&
    left.bodySlots.length === right.bodySlots.length &&
    left.bodySlots.every((slot, index) => slot === right.bodySlots[index]) &&
    sameBytes(left.ciphertextBytes, right.ciphertextBytes)
  );
}

function createIntentKey(
  fileId: string,
  baseRevisionId: string,
  serializedCandidate: string,
): string {
  return JSON.stringify([
    fileId,
    baseRevisionId,
    serializedCandidate,
  ]);
}

function mapAdapterWriteError(error: unknown): LedgerFileRepositoryError {
  if (
    error instanceof LedgerFileAdapterError &&
    error.stage === "readback"
  ) {
    return new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
      "Ledger file was closed but could not be verified by readback",
      error,
    );
  }

  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.WRITE_FAILED,
    "Ledger file write or close failed",
    error,
  );
}

function externalChangeError(
  message: string,
  cause?: unknown,
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE,
    message,
    cause,
  );
}

function clearAuthorizationError(): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
    "Ready ledger clear authorization is invalid, stale, or already used",
  );
}

function importAuthorizationError(
  message =
    "Ready ledger import authorization is invalid, stale, cancelled, or already used",
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED,
    message,
  );
}

function importRecoveryBlockedError(
  cause: unknown,
): LedgerFileRepositoryError {
  return new LedgerFileRepositoryError(
    LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED,
    "Ledger-file import could not safely restore and verify the exact pre-import C",
    cause,
  );
}

function assertImportActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw importAuthorizationError(
      "Ready ledger import was cancelled by its bound lifecycle",
    );
  }
}

function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}
