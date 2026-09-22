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
  claimLedgerSessionPersistencePort,
} from "@/platform/persistence";
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
  createTestLease,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it.each([
    [
      "in-use",
      LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    ],
    [
      "unsupported",
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_UNSUPPORTED,
    ],
    [
      "coordination-failed",
      LEDGER_FILE_ACCESS_ERROR_CODES.COORDINATION_FAILED,
    ],
  ] as const)(
    "maps coordinator %s before publishing a writable session",
    async (status, code) => {
      const handle = await createExistingLedgerHandle(
        `coordination-${status}`,
      );
      const coordinator: LedgerFileSessionCoordinator = {
        acquire: vi.fn(async () => ({ status })),
      };
      const { controller } = createController(
        handle,
        handle,
        coordinator,
      );
      await controller.selectExisting();

      await expect(
        controller.unlockSelected(PASSPHRASE),
      ).resolves.toEqual({
        status: "error",
        ok: false,
        code,
      });
      expect(handle.writes).toBe(0);
    },
  );

  it("releases a newly acquired lease after a wrong-password failure and keeps the selection retryable", async () => {
    const handle = await createExistingLedgerHandle("lease-failure");
    const wrongPasswordLease = createTestLease("wrong-password");
    vi.mocked(wrongPasswordLease.release)
      .mockRejectedValueOnce(
        new Error("wrong-password release failed"),
      )
      .mockResolvedValueOnce(undefined);
    const leases = [
      wrongPasswordLease,
      createTestLease("correct-password"),
    ];
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease: leases.shift()!,
      })),
    };
    const { controller } = createController(
      handle,
      handle,
      coordinator,
    );
    await controller.selectExisting();

    await expect(
      controller.unlockSelected("another valid passphrase"),
    ).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    });
    expect(
      coordinator.acquire,
    ).toHaveBeenCalledOnce();
    expect(wrongPasswordLease.release).toHaveBeenCalledOnce();

    await expect(
      controller.unlockSelected(PASSPHRASE),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    expect(coordinator.acquire).toHaveBeenCalledOnce();
    controller.cancelPendingSelection();
    await vi.waitFor(() => {
      expect(wrongPasswordLease.release).toHaveBeenCalledTimes(2);
    });
    expect(wrongPasswordLease.release).toHaveBeenCalledTimes(2);

    await expect(controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
    const result = await controller.unlockSelected(PASSPHRASE);
    expect(result.status).toBe("unlocked");
    expect(coordinator.acquire).toHaveBeenCalledTimes(2);
  });

  it("refuses to replace an active session with a different file", async () => {
    const firstHandle = new MemoryFileHandle("first.lftl");
    const differentHandle = await createExistingLedgerHandle("different");
    const firstLease = createTestLease("active-first");
    const coordinator: LedgerFileSessionCoordinator = {
      acquire: vi.fn(async () => ({
        status: "acquired" as const,
        lease: firstLease,
      })),
    };
    const provider: LedgerFilePickerProvider = {
      showSaveFilePicker: vi
        .fn()
        .mockResolvedValueOnce(firstHandle)
        .mockResolvedValueOnce(differentHandle),
      showOpenFilePicker: vi.fn(async () => [differentHandle]),
    };
    const controller = new DefaultLedgerFileAccessController(
      new LedgerFileHandleAdapter(provider),
      {
        generateId: vi
          .fn<() => string>()
          .mockReturnValueOnce("file-first")
          .mockReturnValueOnce("revision-first"),
        now: () => new Date("2026-07-28T10:00:00.000Z"),
      },
      coordinator,
    );

    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "unlocked",
    });
    await expect(controller.create(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });

    expect(provider.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(provider.showOpenFilePicker).not.toHaveBeenCalled();
    expect(coordinator.acquire).toHaveBeenCalledOnce();
    expect(firstLease.release).not.toHaveBeenCalled();
  });

  it("retains an active lease after release failure, deduplicates concurrent release, and permits an explicit retry", async () => {
    const handle = new MemoryFileHandle("release-retry.lftl");
    const firstRelease = createDeferred<void>();
    const release = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstRelease.promise)
      .mockResolvedValueOnce(undefined);
    const lease: LedgerFileSessionLease = {
      sessionId: "release-retry",
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
    const created = await controller.create(PASSPHRASE);
    expect(created.status).toBe("unlocked");
    if (created.status !== "unlocked") return;
    const persistencePort = claimLedgerSessionPersistencePort(
      created.session,
      {},
    );
    const request = created.session.beginQuiesce("immediate-lock");
    const token = await persistencePort.completeQuiesce(
      request,
      Promise.resolve(),
    );
    const releaseOne = created.session.lockAfterQuiesce(token);
    const releaseTwo = created.session.lockAfterQuiesce(token);
    expect(releaseTwo).toBe(releaseOne);
    expect(release).toHaveBeenCalledOnce();
    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
    expect(provider.showSaveFilePicker).toHaveBeenCalledOnce();
    expect(provider.showOpenFilePicker).not.toHaveBeenCalled();

    const rejectedRelease = expect(releaseOne).rejects.toThrow(
      "release failed",
    );
    firstRelease.reject(new Error("release failed"));
    await rejectedRelease;
    await expect(controller.create(PASSPHRASE)).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });

    await expect(
      created.session.lockAfterQuiesce(token),
    ).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
    await expect(controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
  });
});
