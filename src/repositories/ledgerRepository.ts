import type { StorageAdapter } from "../adapters/storageAdapter";
import { validateStoredLedgerEnvelopeV2 } from "../encryption/cryptoEnvelope";
import type { EncryptionService } from "../encryption/encryptionService";
import type { LedgerData } from "../models";
import { validateLedgerData } from "../validators/ledgerDataValidator";

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
  clear(): Promise<void>;
}

export class DefaultLedgerRepository implements LedgerRepository {
  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly encryptionService: EncryptionService,
  ) {}

  async load(): Promise<LedgerData | null> {
    let storedValue: unknown | null;

    try {
      storedValue = await this.storageAdapter.read();
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.READ_FAILED,
        "Could not read saved ledger data",
        error,
      );
    }

    if (storedValue === null) {
      return null;
    }

    const envelopeValidation =
      validateStoredLedgerEnvelopeV2(storedValue);

    if (!envelopeValidation.ok) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
        "Saved ledger envelope is invalid",
      );
    }

    let parsedData: unknown;

    try {
      const plaintext = await this.encryptionService.decrypt(
        envelopeValidation.value,
      );
      parsedData = JSON.parse(plaintext);
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
        "Saved ledger payload could not be decrypted or parsed",
        error,
      );
    }

    const validationResult = validateLedgerData(parsedData);

    if (!validationResult.ok) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
        "Saved ledger payload failed runtime validation",
        validationResult.errors,
      );
    }

    return validationResult.value;
  }

  async save(ledgerData: LedgerData): Promise<void> {
    const validationResult = validateLedgerData(ledgerData);

    if (!validationResult.ok) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.INVALID_LEDGER_DATA,
        "Ledger data failed runtime validation before save",
        validationResult.errors,
      );
    }

    try {
      const plaintext = JSON.stringify(validationResult.value);
      const envelope = await this.encryptionService.encrypt(plaintext);
      const envelopeValidation =
        validateStoredLedgerEnvelopeV2(envelope);

      if (!envelopeValidation.ok) {
        throw new Error("Encryption service returned an invalid envelope");
      }

      await this.storageAdapter.write(envelopeValidation.value);
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
        "Could not save ledger data",
        error,
      );
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storageAdapter.clear();
    } catch (error) {
      throw new LedgerRepositoryError(
        LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
        "Could not clear saved ledger data",
        error,
      );
    }
  }
}
