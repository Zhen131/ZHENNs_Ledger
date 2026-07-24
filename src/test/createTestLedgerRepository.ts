import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "../adapters/indexedDbStorageAdapter";
import { NoopEncryptionService } from "../encryption/noopEncryptionService";
import {
  DefaultLedgerRepository,
  type LedgerRepository,
} from "../repositories/ledgerRepository";

export function createTestLedgerRepository(
  storageOptions: IndexedDbStorageAdapterOptions = {},
): LedgerRepository {
  return new DefaultLedgerRepository(
    new IndexedDbStorageAdapter(storageOptions),
    new NoopEncryptionService(),
  );
}
