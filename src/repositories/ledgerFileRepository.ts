import {
  LedgerFileAdapterError,
  type LedgerFileHandle,
  type LedgerFileHandleAdapter,
} from "../adapters/ledgerFileHandleAdapter";
import type { LedgerFileSessionLease } from "../coordination/ledgerFileSessionCoordinator";
import {
  createCanonicalLedgerPayloadV1,
  type CanonicalLedgerPayloadV1,
  type DecryptedLedgerPayloadV1,
  type EncryptedLedgerGenerationV1,
  type LedgerFileV1,
  validateDecryptedLedgerPayloadV1,
  validateLedgerFileV1,
} from "../encryption/ledgerFileContract";
import { LedgerFileCrypto } from "../encryption/ledgerFileCrypto";
import type { CryptoProvider } from "../encryption/webCryptoEncryptionService";
import type { LedgerData } from "../models";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  createReadyLedgerClearAuthorizationForDriver,
  isReadyLedgerClearAuthorizationContextForDriver,
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerRepositoryError,
  READY_LEDGER_CLEAR_CONFIRMATION_TEXT,
  type LedgerReadyClearDriver,
  type LedgerRepository,
  type ReadyLedgerClearAuthorization,
  type ReadyLedgerClearAuthorizationContext,
  type ReadyLedgerClearExecutionContext,
} from "./ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";

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
  generation: EncryptedLedgerGenerationV1;
  payload: DecryptedLedgerPayloadV1;
  serializedPayload: string;
  serializedLedgerData: string;
};

type VerifiedLedgerFile = {
  file: LedgerFileV1;
  current: VerifiedGeneration;
  previous: VerifiedGeneration | null;
  serializedFile: string;
};

type PendingSaveIntent = {
  key: string;
  baseFile: LedgerFileV1;
  baseSerializedFile: string;
  baseCurrent: VerifiedGeneration;
  file: LedgerFileV1;
  serializedFile: string;
  expectedCurrent: CanonicalLedgerPayloadV1;
};

type PendingRecoveryIntent = {
  file: LedgerFileV1;
  serializedFile: string;
  expectedCurrent: CanonicalLedgerPayloadV1;
};

type PendingClearIntent = PendingSaveIntent & {
  authorization: ReadyLedgerClearAuthorization;
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

export type LedgerFileOpenResult =
  | { status: "opened"; repository: LedgerFileRepository }
  | {
      status: "recovery-required";
      candidate: LedgerFileRecoveryCandidate;
    };

export class LedgerFileRepository
  implements LedgerRepository, LedgerReadyClearDriver
{
  private pendingIntent: PendingSaveIntent | null = null;
  private pendingClearIntent: PendingClearIntent | null = null;
  private activeClearAuthorization:
    | ReadyLedgerClearAuthorization
    | null = null;
  private latestSaveRequest = 0;

  private constructor(
    private readonly adapter: LedgerFileHandleAdapter,
    private readonly handle: LedgerFileHandle,
    private readonly crypto: LedgerFileCrypto,
    private verified: VerifiedLedgerFile,
    private readonly sessionLease: LedgerFileSessionLease,
    private readonly generateId: () => string,
    private readonly now: () => Date,
  ) {}

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
      const payloadResult = createCanonicalLedgerPayloadV1(
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

      const current = await crypto.encryptGeneration(
        fileId,
        {
          revisionId,
          parentRevisionId: null,
          ledgerSchemaVersion: 1,
        },
        payloadResult.value.serializedPayload,
      );
      const file: LedgerFileV1 = {
        fileFormatVersion: 1,
        fileId,
        crypto: crypto.getCryptoMetadata(),
        current,
        previous: null,
      };
      assertValidLedgerFile(file);
      const serializedFile = serializeLedgerFile(file);
      let readback: string;
      try {
        readback = (
          await adapter.writeAndReadBack(handle, serializedFile)
        ).text;
      } catch (error) {
        throw mapAdapterWriteError(error);
      }

      const verified = await verifySerializedLedgerFile(
        readback,
        crypto,
        {
          fileId,
          currentRevisionId: revisionId,
          currentParentRevisionId: null,
          currentGeneration: current,
          currentPayload: payloadResult.value,
          previousGeneration: null,
          previousPayload: null,
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
    const read = await adapter.read(handle);
    const file = parseAndValidateLedgerFile(read.text);
    if (
      dependencies.expectedFileId !== undefined &&
      file.fileId !== dependencies.expectedFileId
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
        "Selected ledger file identity changed before unlock",
      );
    }

    const crypto = await LedgerFileCrypto.createForUnlock(
      passphrase,
      file.crypto,
      dependencies.cryptoProvider,
    );
    const verified = await verifyLedgerFileForOpen(
      file,
      read.text,
      crypto,
    );
    const generateId = dependencies.generateId ?? defaultGenerateId;
    const now = dependencies.now ?? (() => new Date());
    if (verified.status === "recovery-required") {
      return {
        status: "recovery-required",
        candidate: new LedgerFileRecoveryCandidate(
          adapter,
          handle,
          crypto,
          file,
          read.text,
          verified.previous,
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
    return structuredClone(this.verified.current.payload.ledgerData);
  }

  async save(candidate: LedgerData): Promise<void> {
    const candidateValidation = createCanonicalLedgerPayloadV1(
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
    return this.sessionLease.runExclusiveWrite(() =>
      saveRequest === this.latestSaveRequest
        ? this.saveExclusive(candidate)
        : Promise.resolve(),
    );
  }

  private async saveExclusive(candidate: LedgerData): Promise<void> {
    if (this.pendingClearIntent) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.CLEAR_AUTHORIZATION_FAILED,
        "A ledger-file clear intent must be reconciled before saving",
      );
    }
    const candidateForComparison = createCanonicalLedgerPayloadV1(
      candidate,
      this.verified.current.payload.savedAt,
    );
    if (!candidateForComparison.ok) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Ledger data failed validation before file save",
        candidateForComparison.errors,
      );
    }

    if (this.pendingIntent) {
      const pendingResult = await this.reconcilePendingIntent();
      if (
        pendingResult === "committed" &&
        candidateForComparison.value.serializedLedgerData ===
          this.verified.current.serializedLedgerData
      ) {
        return;
      }

      if (pendingResult === "base") {
        const key = createIntentKey(
          this.verified.file.fileId,
          this.verified.file.current.revisionId,
          candidateForComparison.value.serializedLedgerData,
        );
        if (this.pendingIntent?.key === key) {
          await this.writePendingIntent(this.pendingIntent);
          return;
        }
        this.pendingIntent = null;
      }
    } else {
      await this.assertDiskMatchesVerified();
    }

    if (
      candidateForComparison.value.serializedLedgerData ===
      this.verified.current.serializedLedgerData
    ) {
      return;
    }

    const payloadResult = createCanonicalLedgerPayloadV1(
      candidate,
      this.now().toISOString(),
    );
    if (!payloadResult.ok) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Ledger data failed validation before file save",
        payloadResult.errors,
      );
    }

    const baseFile = this.verified.file;
    const revisionId = this.generateId();
    if (revisionId === baseFile.current.revisionId) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
        "Revision generator returned the current revision",
      );
    }

    const current = await this.crypto.encryptGeneration(
      baseFile.fileId,
      {
        revisionId,
        parentRevisionId: baseFile.current.revisionId,
        ledgerSchemaVersion: 1,
      },
      payloadResult.value.serializedPayload,
    );
    const nextFile: LedgerFileV1 = {
      fileFormatVersion: 1,
      fileId: baseFile.fileId,
      crypto: baseFile.crypto,
      current,
      previous: baseFile.current,
    };
    assertValidLedgerFile(nextFile);
    const pendingIntent: PendingSaveIntent = {
      key: createIntentKey(
        baseFile.fileId,
        baseFile.current.revisionId,
        payloadResult.value.serializedLedgerData,
      ),
      baseFile,
      baseSerializedFile: this.verified.serializedFile,
      baseCurrent: this.verified.current,
      file: nextFile,
      serializedFile: serializeLedgerFile(nextFile),
      expectedCurrent: payloadResult.value,
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
      this.pendingIntent
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
    const payloadResult = createCanonicalLedgerPayloadV1(
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
    const current = await this.crypto.encryptGeneration(
      baseFile.fileId,
      {
        revisionId,
        parentRevisionId: baseFile.current.revisionId,
        ledgerSchemaVersion: 1,
      },
      payloadResult.value.serializedPayload,
    );
    const nextFile: LedgerFileV1 = {
      fileFormatVersion: 1,
      fileId: baseFile.fileId,
      crypto: baseFile.crypto,
      current,
      previous: baseFile.current,
    };
    assertValidLedgerFile(nextFile);
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
      file: nextFile,
      serializedFile: serializeLedgerFile(nextFile),
      expectedCurrent: payloadResult.value,
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
    let readText: string;
    try {
      readText = (await this.adapter.read(this.handle)).text;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not reconcile the previous ledger file clear intent",
        error,
      );
    }
    if (readText === pending.serializedFile) {
      this.verified = await verifySerializedLedgerFile(
        readText,
        this.crypto,
        expectedFromPending(pending),
      );
      this.pendingClearIntent = null;
      return "committed";
    }
    if (readText !== pending.baseSerializedFile) {
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
    let readback: string;
    try {
      readback = (
        await this.adapter.writeAndReadBack(
          this.handle,
          pending.serializedFile,
        )
      ).text;
    } catch (error) {
      throw mapAdapterWriteError(error);
    }
    this.verified = await verifySerializedLedgerFile(
      readback,
      this.crypto,
      expectedFromPending(pending),
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

    let readText: string;
    try {
      readText = (await this.adapter.read(this.handle)).text;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not reconcile the previous ledger file save intent",
        error,
      );
    }

    if (readText === pending.serializedFile) {
      const diskFile = parseAndValidateLedgerFile(readText);
      const verified = await verifyLedgerFile(
        diskFile,
        this.crypto,
        expectedFromPending(pending),
        readText,
      );
      this.verified = verified;
      this.pendingIntent = null;
      return "committed";
    }

    if (readText !== pending.baseSerializedFile) {
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
    let readback: string;
    try {
      readback = (
        await this.adapter.writeAndReadBack(
          this.handle,
          pending.serializedFile,
        )
      ).text;
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

    this.verified = verified;
    if (this.pendingIntent === pending) {
      this.pendingIntent = null;
    }
  }

  private async assertDiskMatchesVerified(): Promise<void> {
    let readText: string;
    try {
      readText = (await this.adapter.read(this.handle)).text;
    } catch (error) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.READBACK_FAILED,
        "Could not re-read the ledger file before saving",
        error,
      );
    }

    if (readText !== this.verified.serializedFile) {
      throw externalChangeError(
        "Ledger file changed outside the current session",
      );
    }
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
    private readonly damagedFile: LedgerFileV1,
    private readonly serializedBaseline: string,
    private readonly verifiedPrevious: VerifiedGeneration,
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
      diskText === this.pendingIntent.serializedFile
    ) {
      const verified = await verifySerializedLedgerFile(
        diskText,
        this.crypto,
        expectedFromRecovery(
          this.pendingIntent,
          this.damagedFile.previous!,
          this.verifiedPrevious,
        ),
      );
      return this.createRepository(verified);
    }
    if (diskText !== this.serializedBaseline) {
      throw externalChangeError(
        "Ledger file changed after recovery was offered",
      );
    }

    if (!this.pendingIntent) {
      const payloadResult = createCanonicalLedgerPayloadV1(
        this.verifiedPrevious.payload.ledgerData,
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
        revisionId === this.damagedFile.current.revisionId ||
        revisionId === this.damagedFile.previous!.revisionId
      ) {
        throw new LedgerFileRepositoryError(
          LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_CANDIDATE,
          "Revision generator returned an existing recovery revision",
        );
      }
      const current = await this.crypto.encryptGeneration(
        this.damagedFile.fileId,
        {
          revisionId,
          parentRevisionId:
            this.damagedFile.previous!.revisionId,
          ledgerSchemaVersion: 1,
        },
        payloadResult.value.serializedPayload,
      );
      const recoveredFile: LedgerFileV1 = {
        fileFormatVersion: 1,
        fileId: this.damagedFile.fileId,
        crypto: this.damagedFile.crypto,
        current,
        previous: this.damagedFile.previous,
      };
      assertValidLedgerFile(recoveredFile);
      this.pendingIntent = {
        file: recoveredFile,
        serializedFile: serializeLedgerFile(recoveredFile),
        expectedCurrent: payloadResult.value,
      };
    }

    if (this.cancelled) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.AUTHENTICATION_FAILED,
        "Ledger file recovery candidate was cancelled before writing",
      );
    }

    let readback: string;
    try {
      readback = (
        await this.adapter.writeAndReadBack(
          this.handle,
          this.pendingIntent.serializedFile,
        )
      ).text;
    } catch (error) {
      throw mapAdapterWriteError(error);
    }
    const verified = await verifySerializedLedgerFile(
      readback,
      this.crypto,
      expectedFromRecovery(
        this.pendingIntent,
        this.damagedFile.previous!,
        this.verifiedPrevious,
      ),
    );
    return this.createRepository(verified);
  }

  private async readForRecovery(): Promise<string> {
    try {
      return (await this.adapter.read(this.handle)).text;
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
): Promise<LedgerFileV1> {
  const read = await adapter.read(handle);
  return parseAndValidateLedgerFile(read.text);
}

function expectedFromPending(pending: PendingSaveIntent) {
  return {
    fileId: pending.file.fileId,
    currentRevisionId: pending.file.current.revisionId,
    currentParentRevisionId:
      pending.baseFile.current.revisionId,
    currentGeneration: pending.file.current,
    currentPayload: pending.expectedCurrent,
    previousGeneration: pending.baseFile.current,
    previousPayload: pending.baseCurrent,
  };
}

function expectedFromRecovery(
  pending: PendingRecoveryIntent,
  previousGeneration: EncryptedLedgerGenerationV1,
  previousPayload: VerifiedGeneration,
): VerificationExpectation {
  return {
    fileId: pending.file.fileId,
    currentRevisionId: pending.file.current.revisionId,
    currentParentRevisionId: previousGeneration.revisionId,
    currentGeneration: pending.file.current,
    currentPayload: pending.expectedCurrent,
    previousGeneration,
    previousPayload,
  };
}

async function verifySerializedLedgerFile(
  serialized: string,
  crypto: LedgerFileCrypto,
  expected?: VerificationExpectation,
): Promise<VerifiedLedgerFile> {
  return verifyLedgerFile(
    parseAndValidateLedgerFile(serialized),
    crypto,
    expected,
    serialized,
  );
}

type VerificationExpectation = {
  fileId: string;
  currentRevisionId: string;
  currentParentRevisionId: string | null;
  currentGeneration: EncryptedLedgerGenerationV1;
  currentPayload: CanonicalLedgerPayloadV1;
  previousGeneration: EncryptedLedgerGenerationV1 | null;
  previousPayload: Pick<
    VerifiedGeneration,
    "serializedPayload" | "serializedLedgerData"
  > | null;
};

async function verifyLedgerFile(
  file: LedgerFileV1,
  crypto: LedgerFileCrypto,
  expected?: VerificationExpectation,
  serializedFile = serializeLedgerFile(file),
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
  }

  return { file, current, previous, serializedFile };
}

async function verifyLedgerFileForOpen(
  file: LedgerFileV1,
  serializedFile: string,
  crypto: LedgerFileCrypto,
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
    },
  };
}

async function verifyGeneration(
  file: LedgerFileV1,
  generation: EncryptedLedgerGenerationV1,
  crypto: LedgerFileCrypto,
): Promise<VerifiedGeneration> {
  const plaintext = await crypto.decryptGeneration(
    file.fileId,
    generation,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Decrypted ledger generation is not valid JSON",
      error,
    );
  }

  const payloadResult = validateDecryptedLedgerPayloadV1(parsed);
  if (!payloadResult.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Decrypted ledger generation failed runtime validation",
      payloadResult.errors,
    );
  }
  if (
    generation.ledgerSchemaVersion !==
    payloadResult.value.value.ledgerData.schemaVersion
  ) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Generation ledger schema version does not match the payload",
    );
  }

  return {
    generation,
    payload: payloadResult.value.value,
    serializedPayload: payloadResult.value.serializedPayload,
    serializedLedgerData: payloadResult.value.serializedLedgerData,
  };
}

function parseAndValidateLedgerFile(serialized: string): LedgerFileV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file is not valid JSON",
      error,
    );
  }

  const validation = validateLedgerFileV1(parsed);
  if (!validation.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Ledger file failed the strict V1 envelope contract",
      validation.errors,
    );
  }
  return validation.value;
}

function assertValidLedgerFile(file: LedgerFileV1): void {
  const validation = validateLedgerFileV1(file);
  if (!validation.ok) {
    throw new LedgerFileRepositoryError(
      LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE,
      "Generated ledger file failed its own V1 contract",
      validation.errors,
    );
  }
}

function serializeLedgerFile(file: LedgerFileV1): string {
  return JSON.stringify({
    fileFormatVersion: file.fileFormatVersion,
    fileId: file.fileId,
    crypto: {
      cryptoVersion: file.crypto.cryptoVersion,
      kdf: {
        name: file.crypto.kdf.name,
        hash: file.crypto.kdf.hash,
        iterations: file.crypto.kdf.iterations,
        saltBase64Url: file.crypto.kdf.saltBase64Url,
      },
      cipher: {
        name: file.crypto.cipher.name,
        keyLength: file.crypto.cipher.keyLength,
        tagLength: file.crypto.cipher.tagLength,
      },
    },
    current: orderedGeneration(file.current),
    previous: file.previous ? orderedGeneration(file.previous) : null,
  });
}

function orderedGeneration(
  generation: EncryptedLedgerGenerationV1,
): EncryptedLedgerGenerationV1 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    ivBase64Url: generation.ivBase64Url,
    ciphertextBase64Url: generation.ciphertextBase64Url,
  };
}

function sameGeneration(
  left: EncryptedLedgerGenerationV1,
  right: EncryptedLedgerGenerationV1,
): boolean {
  return JSON.stringify(orderedGeneration(left)) ===
    JSON.stringify(orderedGeneration(right));
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

function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}
