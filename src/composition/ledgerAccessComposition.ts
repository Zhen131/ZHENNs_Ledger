import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "../adapters/indexedDbStorageAdapter";
import { LedgerFileHandleAdapter } from "../adapters/ledgerFileHandleAdapter";
import {
  IndexedDbLedgerFileConnectionAdapter,
  type IndexedDbLedgerFileConnectionAdapterOptions,
} from "../adapters/ledgerFileConnectionAdapter";
import { DefaultLedgerFileSessionCoordinator } from "../coordination/ledgerFileSessionCoordinator";
import {
  LEDGER_ACCESS_ERROR_CODES,
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
  const legacyPresenceStorage = new IndexedDbStorageAdapter(storageOptions);
  return Object.freeze({
    inspect: async () => {
      try {
        return (await legacyPresenceStorage.read()) === null
          ? { status: "setup-required" as const }
          : { status: "unlock-required" as const };
      } catch {
        return {
          status: "error" as const,
          code: LEDGER_ACCESS_ERROR_CODES.READ_FAILED,
        };
      }
    },
  });
}

export function getDefaultLedgerAccessController(): LedgerAccessController {
  defaultAccessController ??= createApplicationLedgerAccessController();
  return defaultAccessController;
}

export function createApplicationLedgerFileAccessController(
  connectionOptions: IndexedDbLedgerFileConnectionAdapterOptions = {},
): LedgerFileAccessController {
  return new DefaultLedgerFileAccessController(
    new LedgerFileHandleAdapter(),
    {},
    new DefaultLedgerFileSessionCoordinator(),
    undefined,
    new IndexedDbLedgerFileConnectionAdapter(connectionOptions),
  );
}

export function getDefaultLedgerFileAccessController(): LedgerFileAccessController {
  defaultFileAccessController ??=
    createApplicationLedgerFileAccessController();
  return defaultFileAccessController;
}
