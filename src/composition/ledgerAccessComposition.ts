import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "../adapters/indexedDbStorageAdapter";
import { LedgerFileHandleAdapter } from "../adapters/ledgerFileHandleAdapter";
import {
  DefaultLedgerAccessController,
  type LedgerAccessController,
} from "./ledgerAccessController";
import {
  DefaultLedgerFileAccessController,
  type LedgerFileAccessController,
} from "./ledgerFileAccessController";

let defaultAccessController: LedgerAccessController | undefined;
let defaultFileAccessController: LedgerFileAccessController | undefined;

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

export function createApplicationLedgerFileAccessController(): LedgerFileAccessController {
  return new DefaultLedgerFileAccessController(
    new LedgerFileHandleAdapter(),
  );
}

export function getDefaultLedgerFileAccessController(): LedgerFileAccessController {
  defaultFileAccessController ??=
    createApplicationLedgerFileAccessController();
  return defaultFileAccessController;
}
