import { describe, expect, it, vi } from "vitest";
import {
  LedgerFileHandleAdapter,
  type LedgerFilePickerProvider,
} from "@/platform/files";
import type {
  LedgerFileSessionCoordinator,
  LedgerFileSessionLease,
} from "@/platform/coordination";
import {
  DefaultLedgerFileAccessController,
  LEDGER_FILE_ACCESS_ERROR_CODES,
} from "./ledgerFileAccessController";
import {
  MemoryFileHandle,
  PASSPHRASE,
  createController,
  createDeferred,
  createExistingLedgerHandle,
  createRecoverableLedgerHandle,
  createTestLease,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it(
    "retains a recovery candidate after cancellation release failure and retries one concurrent cancellation",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const firstRelease = createDeferred<void>();
      const release = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(() => firstRelease.promise)
        .mockResolvedValueOnce(undefined);
      const lease: LedgerFileSessionLease = {
        sessionId: "recovery-release-retry",
        runExclusiveWrite: (operation) => operation(),
        release,
      };
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease,
        })),
      };
      const { controller, provider } = createController(
        handle,
        handle,
        coordinator,
      );
      await controller.selectExisting();
      const unlock = await controller.unlockSelected(PASSPHRASE);
      expect(unlock.status).toBe("recovery-required");
      if (unlock.status !== "recovery-required") return;

      const cancelOne = controller.cancelRecovery(unlock.recoveryId);
      const cancelTwo = controller.cancelRecovery(unlock.recoveryId);
      expect(cancelTwo).toBe(cancelOne);
      expect(release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });
      expect(provider.showOpenFilePicker).toHaveBeenCalledOnce();

      const rejectedCancel = expect(cancelOne).rejects.toThrow(
        "candidate release failed",
      );
      firstRelease.reject(new Error("candidate release failed"));
      await rejectedCancel;
      await expect(
        controller.confirmRecovery(unlock.recoveryId),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.RECOVERY_NOT_FOUND,
      });

      await expect(
        controller.cancelRecovery(unlock.recoveryId),
      ).resolves.toBeUndefined();
      expect(release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "releases exactly once when a create becomes stale after acquiring its lease",
    async () => {
      const handle = new MemoryFileHandle("stale-create.lftl");
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile").mockImplementation(async () => {
        readStarted.resolve();
        await continueRead.promise;
        return originalGetFile();
      });
      const lease = createTestLease("stale-create");
      vi.mocked(lease.release)
        .mockRejectedValueOnce(new Error("stale create release failed"))
        .mockResolvedValueOnce(undefined);
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

      const creation = controller.create(PASSPHRASE);
      await readStarted.promise;
      controller.cancelPendingSelection();
      continueRead.resolve();

      await expect(creation).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });
      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledTimes(2);
      });
      expect(lease.release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "releases exactly once when an open becomes stale after acquiring its lease",
    async () => {
      const handle = await createExistingLedgerHandle("stale-open");
      const lease = createTestLease("stale-open");
      vi.mocked(lease.release)
        .mockRejectedValueOnce(new Error("stale open release failed"))
        .mockResolvedValueOnce(undefined);
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
      const readStarted = createDeferred<void>();
      const continueRead = createDeferred<void>();
      const originalGetFile = handle.getFile.bind(handle);
      vi.spyOn(handle, "getFile").mockImplementation(async () => {
        readStarted.resolve();
        await continueRead.promise;
        return originalGetFile();
      });

      const unlocking = controller.unlockSelected(PASSPHRASE);
      await readStarted.promise;
      controller.cancelPendingSelection();
      continueRead.resolve();

      await expect(unlocking).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });
      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledTimes(2);
      });
      expect(lease.release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "retains the lease when a stale recovery candidate cannot release on its first cancellation",
    async () => {
      const { handle } = await createRecoverableLedgerHandle();
      const lease = createTestLease("stale-recovery-open");
      vi.mocked(lease.release)
        .mockRejectedValueOnce(
          new Error("stale recovery release failed"),
        )
        .mockResolvedValueOnce(undefined);
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

      const unlocking = controller.unlockSelected(PASSPHRASE);
      await readStarted.promise;
      controller.cancelPendingSelection();
      continueRead.resolve();

      await expect(unlocking).resolves.toEqual({
        status: "error",
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(handle.writes).toBe(0);
      expect(lease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });

      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledTimes(2);
      });
      expect(lease.release).toHaveBeenCalledTimes(2);
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );

  it(
    "retains every failed cleanup lease from concurrent stale operations and retries all before reopening access",
    async () => {
      const firstHandle = new MemoryFileHandle("stale-one.lftl");
      const secondHandle = new MemoryFileHandle("stale-two.lftl");
      const firstReadStarted = createDeferred<void>();
      const secondReadStarted = createDeferred<void>();
      const continueFirstRead = createDeferred<void>();
      const continueSecondRead = createDeferred<void>();
      const originalFirstGetFile = firstHandle.getFile.bind(firstHandle);
      const originalSecondGetFile =
        secondHandle.getFile.bind(secondHandle);
      vi.spyOn(firstHandle, "getFile")
        .mockImplementationOnce(async () => {
          firstReadStarted.resolve();
          await continueFirstRead.promise;
          return originalFirstGetFile();
        })
        .mockImplementation(originalFirstGetFile);
      vi.spyOn(secondHandle, "getFile")
        .mockImplementationOnce(async () => {
          secondReadStarted.resolve();
          await continueSecondRead.promise;
          return originalSecondGetFile();
        })
        .mockImplementation(originalSecondGetFile);
      const firstLease = createTestLease("stale-one");
      const secondLease = createTestLease("stale-two");
      vi.mocked(firstLease.release)
        .mockRejectedValueOnce(new Error("first cleanup failed"))
        .mockRejectedValueOnce(new Error("first retry failed"))
        .mockResolvedValueOnce(undefined);
      vi.mocked(secondLease.release)
        .mockRejectedValueOnce(new Error("second cleanup failed"))
        .mockResolvedValueOnce(undefined);
      const leases = [firstLease, secondLease];
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({
          status: "acquired" as const,
          lease: leases.shift()!,
        })),
      };
      const provider: LedgerFilePickerProvider = {
        showSaveFilePicker: vi
          .fn()
          .mockResolvedValueOnce(firstHandle)
          .mockResolvedValueOnce(secondHandle),
        showOpenFilePicker: vi.fn(async () => [firstHandle]),
      };
      const controller = new DefaultLedgerFileAccessController(
        new LedgerFileHandleAdapter(provider),
        {
          generateId: vi
            .fn<() => string>()
            .mockReturnValueOnce("file-stale-one")
            .mockReturnValueOnce("revision-stale-one")
            .mockReturnValueOnce("file-stale-two")
            .mockReturnValueOnce("revision-stale-two"),
          now: () => new Date("2026-07-28T10:00:00.000Z"),
        },
        coordinator,
      );

      const firstCreate = controller.create(PASSPHRASE);
      await firstReadStarted.promise;
      const secondCreate = controller.create(PASSPHRASE);
      await secondReadStarted.promise;
      controller.cancelPendingSelection();
      continueFirstRead.resolve();
      continueSecondRead.resolve();

      await expect(firstCreate).resolves.toMatchObject({
        status: "error",
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      await expect(secondCreate).resolves.toMatchObject({
        status: "error",
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
      });
      expect(firstLease.release).toHaveBeenCalledOnce();
      expect(secondLease.release).toHaveBeenCalledOnce();
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });

      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(firstLease.release).toHaveBeenCalledTimes(2);
        expect(secondLease.release).toHaveBeenCalledTimes(2);
      });
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
      });

      controller.cancelPendingSelection();
      await vi.waitFor(() => {
        expect(firstLease.release).toHaveBeenCalledTimes(3);
        expect(secondLease.release).toHaveBeenCalledTimes(2);
      });
      await expect(controller.selectExisting()).resolves.toEqual({
        ok: true,
      });
    },
    15_000,
  );
});
