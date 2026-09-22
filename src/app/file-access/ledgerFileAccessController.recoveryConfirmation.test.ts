import { describe, expect, it, vi } from "vitest";
import type { LedgerFileSessionCoordinator } from "@/platform/coordination";
import {
  claimLedgerSessionPersistencePort,
} from "@/platform/persistence";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
import {
  PASSPHRASE,
  createController,
  createDeferred,
  createRecoverableLedgerHandle,
  createTestLease,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it(
    "keeps recovery opaque until one deduplicated confirmation publishes the verified previous ledger",
    async () => {
      const { handle, previousLedger } =
        await createRecoverableLedgerHandle();
      const lease = createTestLease("controller-recovery");
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      };
      const { controller } = createController(
        handle,
        handle,
        coordinator,
      );
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });

      await expect(
        controller.unlockSelected(PASSPHRASE),
      ).resolves.toEqual({
        status: "recovery-required",
        ok: false,
        recoveryId: "recovery-test",
      });
      expect(handle.writes).toBe(0);

      const first = controller.confirmRecovery("recovery-test");
      const second = controller.confirmRecovery("recovery-test");
      expect(second).toBe(first);
      const result = await first;
      expect(result.status).toBe("unlocked");
      if (result.status !== "unlocked") return;
      await expect(result.session.repository.load()).resolves.toEqual(
        previousLedger,
      );
      expect(handle.writes).toBe(1);

      const persistencePort = claimLedgerSessionPersistencePort(
        result.session,
        {},
      );
      const request =
        result.session.beginQuiesce("immediate-lock");
      const token = await persistencePort.completeQuiesce(
        request,
        Promise.resolve(),
      );
      await result.session.lockAfterQuiesce(token);
      await result.session.lockAfterQuiesce(token);
      expect(lease.release).toHaveBeenCalledOnce();
    },
    15_000,
  );

  it(
    "cancels recovery with zero writes, invalidates the id, and releases only the candidate lease",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const lease = createTestLease("controller-cancel-recovery");
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      };
      const { controller } = createController(
        handle,
        handle,
        coordinator,
      );
      await controller.selectExisting();
      const unlock = await controller.unlockSelected(PASSPHRASE);
      expect(unlock.status).toBe("recovery-required");
      if (unlock.status !== "recovery-required") return;

      await controller.cancelRecovery(unlock.recoveryId);

      expect(handle.writes).toBe(0);
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(
        controller.confirmRecovery(unlock.recoveryId),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
      });
    },
    15_000,
  );

  it(
    "does not publish a real recovery whose confirmation resolves after cancellation",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const lease = createTestLease("slow-recovery-cancel");
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      };
      const { controller } = createController(
        handle,
        handle,
        coordinator,
      );
      await controller.selectExisting();
      const unlocked = await controller.unlockSelected(PASSPHRASE);
      expect(unlocked.status).toBe("recovery-required");
      if (unlocked.status !== "recovery-required") return;
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile")
        .mockImplementationOnce(async () => {
          readStarted.resolve();
          await continueRead.promise;
          return originalGetFile();
        })
        .mockImplementation(originalGetFile);

      const confirmation = controller.confirmRecovery(
        unlocked.recoveryId,
      );
      await readStarted.promise;
      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledOnce();
      });
      continueRead.resolve();

      await expect(confirmation).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(handle.writes).toBe(0);
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );
});
