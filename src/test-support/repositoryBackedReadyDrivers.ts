import type { LedgerData } from "@/core/models";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  claimReadyLedgerImportExecutionContextForDriver,
  createReadyLedgerClearAuthorizationForDriver,
  createReadyLedgerImportAuthorizationForDriver,
  type LedgerReadyClearDriver,
  type LedgerReadyImportDriver,
  type LedgerRepository,
} from "@/platform/persistence";

const TEST_FILE_EVIDENCE = Object.freeze({
  fileId: "repository-backed-test-file",
  verifiedRevisionId: "repository-backed-test-revision",
});

/**
 * Ready-ledger clear and import drivers that finish on the given repository:
 * an authorized clear calls `repository.clear()`, an authorized import calls
 * `repository.save(candidate)`. A ledger-file session built with them reaches
 * the same repository calls a test would otherwise reach without a session.
 */
export function createRepositoryBackedReadyDrivers(
  repository: LedgerRepository,
): Readonly<{
  readyClearDriver: LedgerReadyClearDriver;
  readyImportDriver: LedgerReadyImportDriver;
}> {
  const readyClearDriver: LedgerReadyClearDriver = {
    authorizeReadyClear: (context) =>
      createReadyLedgerClearAuthorizationForDriver(
        context,
        TEST_FILE_EVIDENCE,
      ),
    clearReadyLedger: async (authorization, executionContext) => {
      if (
        !claimReadyLedgerClearExecutionContextForDriver(
          executionContext,
          authorization,
          readyClearDriver,
        )
      ) {
        throw new Error("invalid ready clear execution");
      }
      await repository.clear();
    },
  };
  const readyImportDriver: LedgerReadyImportDriver = {
    authorizeReadyImport: (context) =>
      createReadyLedgerImportAuthorizationForDriver(
        context,
        TEST_FILE_EVIDENCE,
      ),
    importReadyLedger: async (
      authorization,
      candidate: LedgerData,
      executionContext,
    ) => {
      if (
        !claimReadyLedgerImportExecutionContextForDriver(
          executionContext,
          authorization,
          readyImportDriver,
        )
      ) {
        throw new Error("invalid ready import execution");
      }
      await repository.save(candidate);
      return candidate;
    },
  };
  return { readyClearDriver, readyImportDriver };
}
