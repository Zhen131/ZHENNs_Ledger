import {
  LedgerFileAdapterError,
  type LedgerFileHandle,
  type LedgerFileHandleAdapter,
} from "../adapters/ledgerFileHandleAdapter";
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
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerRepositoryError,
  type LedgerRepository,
} from "./ledgerRepository";

export const LEDGER_FILE_REPOSITORY_ERROR_CODES = {
  INVALID_CANDIDATE: "LEDGER_FILE_INVALID_CANDIDATE",
  INVALID_FILE: "LEDGER_FILE_INVALID_FILE",
  AUTHENTICATION_FAILED: "LEDGER_FILE_AUTHENTICATION_FAILED",
  FILE_ID_MISMATCH: "LEDGER_FILE_ID_MISMATCH",
  REVISION_MISMATCH: "LEDGER_FILE_REVISION_MISMATCH",
  WRITE_FAILED: "LEDGER_FILE_WRITE_FAILED",
  READBACK_FAILED: "LEDGER_FILE_READBACK_FAILED",
  CLEAR_UNSUPPORTED: "LEDGER_FILE_CLEAR_UNSUPPORTED",
} as const;

export type LedgerFileRepositoryErrorCode =
  (typeof LEDGER_FILE_REPOSITORY_ERROR_CODES)[keyof typeof LEDGER_FILE_REPOSITORY_ERROR_CODES];

export class LedgerFileRepositoryError extends Error {
  constructor(
    readonly code: LedgerFileRepositoryErrorCode,
    message: string,
    readonly cause?: unknown,
    readonly recoveryAvailable = false,
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
};

type PendingSaveIntent = {
  key: string;
  baseFile: LedgerFileV1;
  baseCurrent: VerifiedGeneration;
  file: LedgerFileV1;
  serializedFile: string;
  expectedCurrent: CanonicalLedgerPayloadV1;
};

export class LedgerFileRepository implements LedgerRepository {
  private pendingIntent: PendingSaveIntent | null = null;

  private constructor(
    private readonly adapter: LedgerFileHandleAdapter,
    private readonly handle: LedgerFileHandle,
    private readonly crypto: LedgerFileCrypto,
    private verified: VerifiedLedgerFile,
    private readonly generateId: () => string,
    private readonly now: () => Date,
  ) {}

  static async create(
    adapter: LedgerFileHandleAdapter,
    handle: LedgerFileHandle,
    passphrase: string,
    initialLedgerData: unknown,
    dependencies: LedgerFileRepositoryDependencies = {},
  ): Promise<LedgerFileRepository> {
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
      readback = (await adapter.writeAndReadBack(handle, serializedFile)).text;
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
      generateId,
      now,
    );
  }

  static async open(
    adapter: LedgerFileHandleAdapter,
    handle: LedgerFileHandle,
    passphrase: string,
    dependencies: LedgerFileRepositoryDependencies & {
      expectedFileId?: string;
    } = {},
  ): Promise<LedgerFileRepository> {
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
    const verified = await verifyLedgerFile(file, crypto);

    return new LedgerFileRepository(
      adapter,
      handle,
      crypto,
      verified,
      dependencies.generateId ?? defaultGenerateId,
      dependencies.now ?? (() => new Date()),
    );
  }

  async load(): Promise<LedgerData> {
    return structuredClone(this.verified.current.payload.ledgerData);
  }

  async save(candidate: LedgerData): Promise<void> {
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

    const diskFile = parseAndValidateLedgerFile(readText);
    if (diskFile.fileId !== pending.file.fileId) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.FILE_ID_MISMATCH,
        "Ledger file identity changed while retrying a save",
      );
    }

    if (diskFile.current.revisionId === pending.file.current.revisionId) {
      const verified = await verifyLedgerFile(
        diskFile,
        this.crypto,
        expectedFromPending(pending),
      );
      this.verified = verified;
      this.pendingIntent = null;
      return "committed";
    }

    if (
      diskFile.current.revisionId !==
        pending.baseFile.current.revisionId ||
      serializeLedgerFile(diskFile) !==
        serializeLedgerFile(pending.baseFile)
    ) {
      throw new LedgerFileRepositoryError(
        LEDGER_FILE_REPOSITORY_ERROR_CODES.REVISION_MISMATCH,
        "Ledger file revision changed while retrying a save",
      );
    }

    await verifyLedgerFile(diskFile, this.crypto);
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
    currentPayload: pending.expectedCurrent,
    previousGeneration: pending.baseFile.current,
    previousPayload: pending.baseCurrent,
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
  );
}

type VerificationExpectation = {
  fileId: string;
  currentRevisionId: string;
  currentParentRevisionId: string | null;
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
      previous !== null,
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

  return { file, current, previous };
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

function defaultGenerateId(): string {
  return globalThis.crypto.randomUUID();
}
