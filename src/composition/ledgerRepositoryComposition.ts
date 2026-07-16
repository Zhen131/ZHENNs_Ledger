import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "../adapters/indexedDbStorageAdapter";
import { NoopEncryptionService } from "../encryption/noopEncryptionService";
import {
  DefaultLedgerRepository,
  type LedgerRepository,
} from "../repositories/ledgerRepository";

let defaultRepository: LedgerRepository | undefined;

/**
 * 全应用唯一知道具体存储与加密实现的组装点。
 */
export function createApplicationLedgerRepository(
  storageOptions: IndexedDbStorageAdapterOptions = {},
): LedgerRepository {
  return new DefaultLedgerRepository(
    new IndexedDbStorageAdapter(storageOptions),
    new NoopEncryptionService(),
  );
}

export function getDefaultLedgerRepository(): LedgerRepository {
  defaultRepository ??= createApplicationLedgerRepository();
  return defaultRepository;
}
