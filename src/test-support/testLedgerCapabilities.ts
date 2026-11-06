import type { LedgerSessionCapabilities } from "@/platform/persistence";

/**
 * Every capability switched on. No production session is built with this
 * combination; tests use it where the behavior under test (clearing after a
 * failed load, importing a backup) must be allowed regardless of the
 * production defaults.
 */
export const ALL_ENABLED_TEST_LEDGER_CAPABILITIES: LedgerSessionCapabilities =
  Object.freeze({
    canClearReadyLedger: true,
    canClearHydrationError: true,
    canImportBackup: true,
  });
