import { vi } from "vitest";
import type { LedgerData } from "@/core/models";
import { validateLedgerData } from "@/core/validation";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerRepositoryError,
  type LedgerRepository,
} from "@/platform/persistence";

/**
 * One saved ledger, kept as the JSON text a repository would write. Several
 * repository instances may share it, which is how a test "remounts" onto the
 * same saved data.
 */
export type ValidatingMemoryLedgerStore = {
  serialized: string | null;
};

export type ValidatingMemoryLedgerStoreHooks = Readonly<{
  /** Runs before the stored text is read; throwing makes `load` fail. */
  read?: () => Promise<void>;
  /** Runs before new text replaces the stored text; throwing makes `save` fail and keeps the old text. */
  write?: (serialized: string) => Promise<void>;
  /** Runs before the stored text is removed; throwing makes `clear` fail and keeps the old text. */
  clear?: () => Promise<void>;
}>;

export function createValidatingMemoryLedgerStore(
  initialLedger: LedgerData | null = null,
): ValidatingMemoryLedgerStore {
  return {
    serialized:
      initialLedger === null ? null : JSON.stringify(initialLedger),
  };
}

/**
 * Test repository with no storage engine and no encryption, but with the same
 * three checks a real repository applies: validate before save, a JSON round
 * trip, and validate again on load. Failures use the repository error codes.
 */
export function createValidatingMemoryLedgerRepository(
  store: ValidatingMemoryLedgerStore = createValidatingMemoryLedgerStore(),
  hooks: ValidatingMemoryLedgerStoreHooks = {},
) {
  const write = vi.fn(async (serialized: string) => {
    await hooks.write?.(serialized);
    store.serialized = serialized;
  });
  const clearStored = vi.fn(async () => {
    await hooks.clear?.();
    store.serialized = null;
  });

  const repository: LedgerRepository = {
    async load(): Promise<LedgerData | null> {
      let serialized: string | null;
      try {
        await hooks.read?.();
        serialized = store.serialized;
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.READ_FAILED,
          "Could not read saved ledger data",
          error,
        );
      }
      if (serialized === null) {
        return null;
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(serialized);
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
          "Saved ledger payload could not be parsed",
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
    },

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
        await write(JSON.stringify(validationResult.value));
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
          "Could not save ledger data",
          error,
        );
      }
    },

    async clear(): Promise<void> {
      try {
        await clearStored();
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
          "Could not clear saved ledger data",
          error,
        );
      }
    },
  };

  return {
    repository,
    store,
    /** Counts every write attempt, failed ones included. */
    write,
    /** Counts every clear attempt, failed ones included. */
    clear: clearStored,
    /** The saved ledger parsed back from its JSON text, or null when nothing is saved. */
    readStoredLedger: (): unknown =>
      store.serialized === null ? null : JSON.parse(store.serialized),
  };
}
