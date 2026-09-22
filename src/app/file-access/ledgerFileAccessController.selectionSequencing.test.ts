import {
  describe,
  expect,
  it,
} from "vitest";
import { type LedgerFileHandle } from "@/platform/files";
import { createInitialLedgerData } from "@/core/state";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
import {
  MemoryFileHandle,
  PASSPHRASE,
  createController,
  createDeferred,
  createDeferredSelectionController,
  createExistingLedgerHandle,
  expectSelectedTrade,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it("selects before asking for a password, keeps wrong-password attempts read-only, and unlocks the same file", async () => {
    const handle = new MemoryFileHandle("ledger.lftl");
    const setup = createController(handle);
    expect((await setup.controller.create(PASSPHRASE)).ok).toBe(true);
    handle.writes = 0;

    const open = createController(
      new MemoryFileHandle("unused.lftl"),
      handle,
    );
    await expect(open.controller.selectExisting()).resolves.toEqual({
      ok: true,
    });
    await expect(
      open.controller.unlockSelected("another valid passphrase"),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
    });
    expect(handle.writes).toBe(0);

    const result = await open.controller.unlockSelected(PASSPHRASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.session.repository.load()).resolves.toEqual(
      createInitialLedgerData(),
    );
    expect(handle.writes).toBe(0);
  });

  it("requires a pending explicit selection before unlock", async () => {
    const { controller } = createController(
      new MemoryFileHandle("ledger.lftl"),
    );

    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it("keeps fast B selected when slow A resolves after B", async () => {
    const handleA = await createExistingLedgerHandle("a");
    const handleB = await createExistingLedgerHandle("b");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const deferredB = createDeferred<LedgerFileHandle[]>();
    const { controller } = createDeferredSelectionController([
      deferredA.promise,
      deferredB.promise,
    ]);

    const selectA = controller.selectExisting();
    const selectB = controller.selectExisting();
    deferredB.resolve([handleB]);
    await expect(selectB).resolves.toEqual({ ok: true });
    deferredA.resolve([handleA]);
    await selectA;

    await expectSelectedTrade(controller, "trade-b");
  });

  it("does not revive A when A resolves after cancellation", async () => {
    const handleA = await createExistingLedgerHandle("a");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const { controller } = createDeferredSelectionController([
      deferredA.promise,
    ]);

    const selectA = controller.selectExisting();
    controller.cancelPendingSelection();
    deferredA.resolve([handleA]);
    await selectA;

    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });

  it("does not revive A after successfully creating new C", async () => {
    const handleA = await createExistingLedgerHandle("a");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const created = new MemoryFileHandle("created.lftl");
    const { controller } = createDeferredSelectionController(
      [deferredA.promise],
      created,
    );

    const selectA = controller.selectExisting();
    const createResult = await controller.create(PASSPHRASE);
    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      await expect(
        createResult.session.repository.load(),
      ).resolves.toEqual(createInitialLedgerData());
    }
    deferredA.resolve([handleA]);
    await selectA;

    await expect(controller.unlockSelected(PASSPHRASE)).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.FILE_IN_USE,
    });
  });

  it("does not let a stale A rejection clear a newer B selection", async () => {
    const handleB = await createExistingLedgerHandle("b");
    const deferredA = createDeferred<LedgerFileHandle[]>();
    const deferredB = createDeferred<LedgerFileHandle[]>();
    const { controller } = createDeferredSelectionController([
      deferredA.promise,
      deferredB.promise,
    ]);

    const selectA = controller.selectExisting();
    const selectB = controller.selectExisting();
    deferredB.resolve([handleB]);
    await expect(selectB).resolves.toEqual({ ok: true });
    deferredA.reject(new Error("old picker failed"));
    await selectA;

    await expectSelectedTrade(controller, "trade-b");
  });
});
