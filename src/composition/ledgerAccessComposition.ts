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
  DefaultLegacyLedgerExitController,
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
  const legacyExitController = new DefaultLegacyLedgerExitController(
    new IndexedDbStorageAdapter(storageOptions),
  );
  return Object.freeze({
    inspect: () => legacyExitController.inspect(),
    unlockLegacyForMigration: (passphrase: string) =>
      legacyExitController.unlockLegacyForMigration(passphrase),
    authorizeLegacyMigrationDeletion: (
      ...args: Parameters<
        DefaultLegacyLedgerExitController["authorizeLegacyMigrationDeletion"]
      >
    ) =>
      legacyExitController.authorizeLegacyMigrationDeletion(
        ...args,
      ),
    deleteLegacyAfterMigration: (
      ...args: Parameters<
        DefaultLegacyLedgerExitController["deleteLegacyAfterMigration"]
      >
    ) => legacyExitController.deleteLegacyAfterMigration(...args),
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
