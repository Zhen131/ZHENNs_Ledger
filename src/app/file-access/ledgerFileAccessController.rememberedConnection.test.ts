import { describe, expect, it, vi } from "vitest";
import { type
  LedgerFileConnectionRecordV1 } from "@/platform/files";
import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
import {
  MemoryFileHandle,
  PASSPHRASE,
  createConnectionAdapter,
  createController,
  createDeferred,
  createExistingLedgerHandle,
  createTestCoordinator,
} from "./ledgerFileAccessController.testHelpers";

describe("DefaultLedgerFileAccessController", () => {
  it("rejects 7 code points before the picker and creates with 8 Unicode code points", async () => {
    const handle = new MemoryFileHandle("eight-code-points.lftl");
    const { controller, provider } = createController(handle);

    await expect(controller.create("a".repeat(7))).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED,
    });
    expect(provider.showSaveFilePicker).not.toHaveBeenCalled();

    await expect(controller.create("账本🔐safe8")).resolves.toMatchObject({
      status: "unlocked",
      ok: true,
    });
    expect(provider.showSaveFilePicker).toHaveBeenCalledOnce();
  });

  it("treats an empty connection store as no remembered C without querying permission", async () => {
    const handle = new MemoryFileHandle("empty-record.lftl");
    const connection = createConnectionAdapter();
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(
      controller.inspectRememberedConnection(),
    ).resolves.toEqual({ status: "none", ok: true });
    expect(handle.queryPermission).not.toHaveBeenCalled();
    expect(connection.adapter.write).not.toHaveBeenCalled();
  });

  it("uses query-only granted reconnect and writes the record only after full unlock", async () => {
    const handle = await createExistingLedgerHandle("remembered");
    const record: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle,
      expectedFileId: "file-remembered",
    };
    const connection = createConnectionAdapter(record);
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(
      controller.inspectRememberedConnection(),
    ).resolves.toEqual({ status: "ready", ok: true });
    expect(handle.queryPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    expect(handle.requestPermission).not.toHaveBeenCalled();
    expect(connection.adapter.write).not.toHaveBeenCalled();

    const unlocked = await controller.unlockSelected(PASSPHRASE);
    expect(unlocked.status).toBe("unlocked");
    expect(connection.adapter.write).toHaveBeenCalledOnce();
    expect(connection.current()).toEqual(record);
  });

  it("does not request prompt permission until the explicit reconnect action and reports denied truthfully", async () => {
    const handle = await createExistingLedgerHandle("prompt");
    handle.permissionState = "prompt";
    const record: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle,
      expectedFileId: "file-prompt",
    };
    const connection = createConnectionAdapter(record);
    const { controller } = createController(
      handle,
      handle,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );

    await expect(
      controller.inspectRememberedConnection(),
    ).resolves.toEqual({
      status: "permission-prompt",
      ok: false,
    });
    expect(handle.requestPermission).not.toHaveBeenCalled();

    handle.permissionState = "denied";
    await expect(
      controller.requestRememberedPermission(),
    ).resolves.toEqual({
      status: "error",
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.PERMISSION_DENIED,
    });
    expect(handle.requestPermission).toHaveBeenCalledOnce();
    expect(connection.adapter.write).not.toHaveBeenCalled();
  });

  it("rejects a same-fileId byte copy before reading or replacing the remembered connection", async () => {
    const original = await createExistingLedgerHandle("original");
    const copy = new MemoryFileHandle(
      "copy.lftl",
      original.bytes,
    );
    const record: LedgerFileConnectionRecordV1 = {
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-original",
    };
    const connection = createConnectionAdapter(record);
    const { controller } = createController(
      original,
      copy,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );
    original.permissionState = "denied";
    await controller.inspectRememberedConnection();

    await expect(
      controller.reselectRememberedConnection(),
    ).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.WRONG_RECONNECT_FILE,
    });
    expect(copy.queryPermission).not.toHaveBeenCalled();
    expect(copy.writes).toBe(0);
    expect(connection.adapter.write).not.toHaveBeenCalled();
    expect(connection.current()).toBe(record);
  });

  it("accepts a manually reselected handle only after physical identity and expected fileId both match", async () => {
    const original = await createExistingLedgerHandle("reselect");
    const replacement = new MemoryFileHandle(
      "reselect.lftl",
      original.bytes,
    );
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-reselect",
    });
    const { controller } = createController(
      original,
      replacement,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );
    original.permissionState = "denied";
    await controller.inspectRememberedConnection();

    await expect(
      controller.reselectRememberedConnection(),
    ).resolves.toEqual({ ok: true });
    expect(original.isSameEntry).toHaveBeenCalledWith(replacement);
    expect(replacement.queryPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
    const unlocked = await controller.unlockSelected(PASSPHRASE);
    expect(unlocked.status).toBe("unlocked");
    expect(connection.current()).toMatchObject({
      handle: replacement,
      expectedFileId: "file-reselect",
    });
  });

  it("uses the explicit reselect action to request readwrite permission when the picked handle still prompts", async () => {
    const original = await createExistingLedgerHandle("reselect-prompt");
    const replacement = new MemoryFileHandle(
      "reselect-prompt.lftl",
      original.bytes,
    );
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    replacement.queryPermission.mockResolvedValueOnce("prompt");
    replacement.requestPermission.mockResolvedValueOnce("granted");
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-reselect-prompt",
    });
    const { controller } = createController(
      original,
      replacement,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );
    original.permissionState = "denied";
    await controller.inspectRememberedConnection();

    await expect(
      controller.reselectRememberedConnection(),
    ).resolves.toEqual({ ok: true });
    expect(replacement.queryPermission).toHaveBeenCalledOnce();
    expect(replacement.requestPermission).toHaveBeenCalledWith({
      mode: "readwrite",
    });
  });

  it("invalidates a late permission request from a manual reselect before it can publish the picked file", async () => {
    const original = await createExistingLedgerHandle("late-reselect");
    const replacement = new MemoryFileHandle(
      "late-reselect.lftl",
      original.bytes,
    );
    const permission =
      createDeferred<"granted" | "prompt" | "denied">();
    vi.spyOn(original, "isSameEntry").mockResolvedValue(true);
    replacement.queryPermission.mockResolvedValueOnce("prompt");
    replacement.requestPermission.mockImplementationOnce(
      () => permission.promise,
    );
    const connection = createConnectionAdapter({
      connectionFormatVersion: 1,
      handle: original,
      expectedFileId: "file-late-reselect",
    });
    const { controller } = createController(
      original,
      replacement,
      createTestCoordinator(),
      () => "recovery-test",
      connection.adapter,
    );
    original.permissionState = "denied";
    await controller.inspectRememberedConnection();

    const reconnect = controller.reselectRememberedConnection();
    await vi.waitFor(() => {
      expect(replacement.requestPermission).toHaveBeenCalledOnce();
    });
    controller.cancelPendingSelection();
    permission.resolve("granted");

    await expect(reconnect).resolves.toEqual({
      ok: false,
      code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
    });
    expect(connection.adapter.write).not.toHaveBeenCalled();
    await expect(
      controller.unlockSelected(PASSPHRASE),
    ).resolves.toMatchObject({
      status: "error",
      code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
    });
  });
});
