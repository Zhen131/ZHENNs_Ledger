import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "@/platform/legacy";
import { NoopEncryptionService } from "./noopEncryptionService";
import {
  DefaultLedgerRepository,
  type LedgerRepository,
} from "@/platform/persistence";

export function createTestLedgerRepository(
  storageOptions: IndexedDbStorageAdapterOptions = {},
): LedgerRepository {
  return new DefaultLedgerRepository(
    new IndexedDbStorageAdapter(storageOptions),
    new NoopEncryptionService(),
  );
}
