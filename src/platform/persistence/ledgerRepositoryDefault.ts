import type { StorageAdapter } from "@/platform/legacy";
import { validateStoredLedgerEnvelopeV2 } from "@/platform/legacy";
import type { EncryptionService } from "@/platform/legacy";
import type { LedgerData } from "@/core/models";
import { validateLedgerData } from "@/core/validation";
import type { LedgerRepository } from "./ledgerRepositoryContract";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerRepositoryError,
} from "./ledgerRepositoryContract";

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
