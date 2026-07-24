import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "../adapters/indexedDbStorageAdapter";
import {
  DefaultLedgerAccessController,
  type LedgerAccessController,
} from "./ledgerAccessController";

let defaultAccessController: LedgerAccessController | undefined;

export function createApplicationLedgerAccessController(
  storageOptions: IndexedDbStorageAdapterOptions = {},
): LedgerAccessController {
  return new DefaultLedgerAccessController(
    new IndexedDbStorageAdapter(storageOptions),
  );
}

export function getDefaultLedgerAccessController(): LedgerAccessController {
  defaultAccessController ??= createApplicationLedgerAccessController();
  return defaultAccessController;
}
