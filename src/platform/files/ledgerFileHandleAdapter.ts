/**
 * 这个文件管和浏览器文件功能直接打交道。
 * 包括选文件、问权限、读、写完再读回来核对。
 * 它不管文件里的格式和加密，那在 Container 和 ledgerFileCrypto.ts。
 * 不显然的决定：每次写完都整份读回来核对，写坏了要能发现。2026-09-01 定（W15 06B 修订 E 第 E.2 节）。
 */

import { MAX_LEDGER_FILE_V2_BYTES } from "./ledgerFileContract";
import { LEDGER_FILE_OUTER_V3_CONSTANTS } from "./ledgerFileContainerV3";
import type {
  LedgerFileReadResult,
  LedgerFileBytesReadResult,
  LedgerFilePickerResult,
  LedgerFilePermissionMode,
  LedgerFilePermissionState,
  LedgerFileLike,
  LedgerFileWritable,
  LedgerFileBinaryPatch,
  LedgerFileHandle,
  LedgerFilePickerProvider,
} from "./ledgerFileHandleAdapterContract";
import { LedgerFileAdapterError } from "./ledgerFileHandleAdapterContract";

const FILE_PICKER_TYPES = [
  {
    description: "Zhenn's Ledger",
    accept: {
      "application/octet-stream": [".lftl"],
    },
  },
];

/**
 * 这个类替账本和浏览器的文件功能打交道。
 * 它只认 .lftl 文件；选文件时用户取消，答「取消了」而不是出错。
 * 写入后都会整份读回来，和要写的字节核对。
 * 局部写入保留原有内容，只改那几处；整份写入先清空再写。
 * 举例：写 3670032 字节，读回来少了一个字节 → 抛错，出错步骤是复读。
 * 出错时抛 `LedgerFileAdapterError`，写到一半出错会尽量放弃这次写入。
 */
export class LedgerFileHandleAdapter {
  constructor(
    private readonly pickerProvider?: LedgerFilePickerProvider,
  ) {}

  async pickNewLedgerFile(): Promise<LedgerFilePickerResult> {
    const provider = this.getPickerProvider();
    try {
      const handle = await provider.showSaveFilePicker({
        suggestedName: "local-first-trading-ledger.lftl",
        types: [...FILE_PICKER_TYPES],
        excludeAcceptAllOption: true,
      });
      this.assertLedgerFileExtension(handle);
      return { status: "selected", handle };
    } catch (error) {
      if (isPickerCancellation(error)) {
        return { status: "cancelled" };
      }
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "picker",
        "Could not choose a new ledger file",
        error,
      );
    }
  }

  async pickExistingLedgerFile(): Promise<LedgerFilePickerResult> {
    const provider = this.getPickerProvider();
    try {
      const handles = await provider.showOpenFilePicker({
        multiple: false,
        types: [...FILE_PICKER_TYPES],
        excludeAcceptAllOption: false,
      });
      const handle = handles[0];
      if (!handle || handles.length !== 1) {
        throw new LedgerFileAdapterError(
          "picker",
          "Exactly one ledger file must be selected",
        );
      }
      this.assertLedgerFileExtension(handle);
      return { status: "selected", handle };
    } catch (error) {
      if (isPickerCancellation(error)) {
        return { status: "cancelled" };
      }
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "picker",
        "Could not choose an existing ledger file",
        error,
      );
    }
  }

  async queryPermission(
    handle: LedgerFileHandle,
    mode: LedgerFilePermissionMode = "readwrite",
  ): Promise<LedgerFilePermissionState> {
    if (typeof handle.queryPermission !== "function") {
      throw new LedgerFileAdapterError(
        "permission-query",
        "File permission query is unavailable",
      );
    }
    try {
      return assertPermissionState(
        await handle.queryPermission({ mode }),
        "permission-query",
      );
    } catch (error) {
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "permission-query",
        "Could not query ledger file permission",
        error,
      );
    }
  }

  async requestPermission(
    handle: LedgerFileHandle,
    mode: LedgerFilePermissionMode = "readwrite",
  ): Promise<LedgerFilePermissionState> {
    if (typeof handle.requestPermission !== "function") {
      throw new LedgerFileAdapterError(
        "permission-request",
        "File permission request is unavailable",
      );
    }
    try {
      return assertPermissionState(
        await handle.requestPermission({ mode }),
        "permission-request",
      );
    } catch (error) {
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "permission-request",
        "Could not request ledger file permission",
        error,
      );
    }
  }

  async assertEmptyCreateTarget(handle: LedgerFileHandle): Promise<void> {
    this.assertLedgerFileExtension(handle);
    let file: LedgerFileLike;
    try {
      file = await handle.getFile();
    } catch (error) {
      throw new LedgerFileAdapterError(
        "get-file",
        "Could not inspect the selected create target",
        error,
      );
    }

    if (file.size !== 0) {
      throw new LedgerFileAdapterError(
        "target",
        "Refusing to overwrite a non-empty ledger file",
      );
    }
  }

  async read(handle: LedgerFileHandle): Promise<LedgerFileReadResult> {
    const read = await this.readBytes(handle, MAX_LEDGER_FILE_V2_BYTES);
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(read.bytes),
        byteLength: read.byteLength,
      };
    } catch (error) {
      throw new LedgerFileAdapterError(
        "utf8",
        "Ledger file is not valid UTF-8",
        error,
      );
    }
  }

  async readBinary(
    handle: LedgerFileHandle,
  ): Promise<LedgerFileBytesReadResult> {
    return this.readBytes(
      handle,
      LEDGER_FILE_OUTER_V3_CONSTANTS.maximumFileBytes,
    );
  }

  private async readBytes(
    handle: LedgerFileHandle,
    maximumBytes: number,
  ): Promise<LedgerFileBytesReadResult> {
    this.assertLedgerFileExtension(handle);
    let file: LedgerFileLike;
    try {
      file = await handle.getFile();
    } catch (error) {
      throw new LedgerFileAdapterError(
        "get-file",
        "Could not get the selected ledger file",
        error,
      );
    }

    if (file.size > maximumBytes) {
      throw new LedgerFileAdapterError(
        "size",
        "Ledger file exceeds the 32 MiB outer limit",
      );
    }

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (error) {
      throw new LedgerFileAdapterError(
        "array-buffer",
        "Could not read ledger file bytes",
        error,
      );
    }

    if (buffer.byteLength > maximumBytes) {
      throw new LedgerFileAdapterError(
        "size",
        "Ledger file bytes exceed the 384 MiB outer limit",
      );
    }

    return {
      bytes: new Uint8Array(buffer.slice(0)),
      byteLength: buffer.byteLength,
    };
  }

  async writeAndReadBack(
    handle: LedgerFileHandle,
    serializedFile: string,
    signal?: AbortSignal,
  ): Promise<LedgerFileReadResult> {
    this.assertLedgerFileExtension(handle);
    assertWriteNotAborted(signal);
    const byteLength = new TextEncoder().encode(serializedFile).byteLength;
    if (byteLength > MAX_LEDGER_FILE_V2_BYTES) {
      throw new LedgerFileAdapterError(
        "size",
        "Serialized ledger file exceeds the 32 MiB outer limit",
      );
    }

    let writable: LedgerFileWritable;
    try {
      writable = await handle.createWritable({
        keepExistingData: false,
        mode: "exclusive",
      });
    } catch (error) {
      throw new LedgerFileAdapterError(
        "create-writable",
        "Could not create a ledger file writable stream",
        error,
      );
    }

    const abortWritable = () => {
      void bestEffortAbort(writable, signal?.reason);
    };
    signal?.addEventListener("abort", abortWritable, {
      once: true,
    });

    try {
      if (signal?.aborted) {
        await bestEffortAbort(writable, signal.reason);
        assertWriteNotAborted(signal);
      }
      await writable.write(serializedFile);
      if (signal?.aborted) {
        await bestEffortAbort(writable, signal.reason);
        assertWriteNotAborted(signal);
      }
    } catch (error) {
      signal?.removeEventListener("abort", abortWritable);
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "write",
        "Could not write the complete ledger file",
        error,
      );
    }

    try {
      assertWriteNotAborted(signal);
      await writable.close();
      assertWriteNotAborted(signal);
    } catch (error) {
      signal?.removeEventListener("abort", abortWritable);
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "close",
        "Could not close the ledger file writable stream",
        error,
      );
    }

    try {
      const readback = await this.read(handle);
      assertWriteNotAborted(signal);
      return readback;
    } catch (error) {
      if (error instanceof LedgerFileAdapterError && error.stage === "aborted") {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "readback",
        "Could not read the ledger file after closing the writable stream",
        error,
      );
    } finally {
      signal?.removeEventListener("abort", abortWritable);
    }
  }

  async writeBinaryAndReadBack(
    handle: LedgerFileHandle,
    serializedFile: Uint8Array,
    signal?: AbortSignal,
  ): Promise<LedgerFileBytesReadResult> {
    this.assertLedgerFileExtension(handle);
    assertWriteNotAborted(signal);
    if (
      serializedFile.byteLength >
      LEDGER_FILE_OUTER_V3_CONSTANTS.maximumFileBytes
    ) {
      throw new LedgerFileAdapterError(
        "size",
        "Serialized ledger file exceeds the V3 outer limit",
      );
    }

    let writable: LedgerFileWritable;
    try {
      writable = await handle.createWritable({
        keepExistingData: false,
        mode: "exclusive",
      });
    } catch (error) {
      throw new LedgerFileAdapterError(
        "create-writable",
        "Could not create a ledger file writable stream",
        error,
      );
    }

    const abortWritable = () => {
      void bestEffortAbort(writable, signal?.reason);
    };
    signal?.addEventListener("abort", abortWritable, {
      once: true,
    });

    try {
      if (signal?.aborted) {
        await bestEffortAbort(writable, signal.reason);
        assertWriteNotAborted(signal);
      }
      await writable.write(Uint8Array.from(serializedFile));
      if (signal?.aborted) {
        await bestEffortAbort(writable, signal.reason);
        assertWriteNotAborted(signal);
      }
    } catch (error) {
      signal?.removeEventListener("abort", abortWritable);
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "write",
        "Could not write the complete ledger file",
        error,
      );
    }

    try {
      assertWriteNotAborted(signal);
      await writable.close();
      assertWriteNotAborted(signal);
    } catch (error) {
      signal?.removeEventListener("abort", abortWritable);
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "close",
        "Could not close the ledger file writable stream",
        error,
      );
    }

    try {
      const readback = await this.readBinary(handle);
      assertWriteNotAborted(signal);
      return readback;
    } catch (error) {
      if (error instanceof LedgerFileAdapterError && error.stage === "aborted") {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "readback",
        "Could not read the ledger file after closing the writable stream",
        error,
      );
    } finally {
      signal?.removeEventListener("abort", abortWritable);
    }
  }

  async writeBinaryPatchesAndReadBack(
    handle: LedgerFileHandle,
    patches: readonly LedgerFileBinaryPatch[],
    expectedFileByteLength: number,
    signal?: AbortSignal,
  ): Promise<LedgerFileBytesReadResult> {
    this.assertLedgerFileExtension(handle);
    assertWriteNotAborted(signal);
    assertValidBinaryPatches(patches, expectedFileByteLength);

    let writable: LedgerFileWritable;
    try {
      writable = await handle.createWritable({
        keepExistingData: true,
        mode: "exclusive",
      });
    } catch (error) {
      throw new LedgerFileAdapterError(
        "create-writable",
        "Could not create a positioned ledger file writable stream",
        error,
      );
    }

    const abortWritable = () => {
      void bestEffortAbort(writable, signal?.reason);
    };
    signal?.addEventListener("abort", abortWritable, { once: true });

    try {
      for (const patch of patches) {
        assertWriteNotAborted(signal);
        await writable.write({
          type: "write",
          position: patch.position,
          data: Uint8Array.from(patch.data),
        });
      }
      assertWriteNotAborted(signal);
    } catch (error) {
      signal?.removeEventListener("abort", abortWritable);
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "write",
        "Could not write the complete ledger file patches",
        error,
      );
    }

    try {
      assertWriteNotAborted(signal);
      await writable.close();
      assertWriteNotAborted(signal);
    } catch (error) {
      signal?.removeEventListener("abort", abortWritable);
      if (error instanceof LedgerFileAdapterError) {
        throw error;
      }
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "close",
        "Could not close the positioned ledger file writable stream",
        error,
      );
    }

    try {
      const readback = await this.readBinary(handle);
      assertWriteNotAborted(signal);
      if (readback.byteLength !== expectedFileByteLength) {
        throw new LedgerFileAdapterError(
          "readback",
          "Positioned ledger file readback length changed",
        );
      }
      return readback;
    } catch (error) {
      if (error instanceof LedgerFileAdapterError && error.stage === "aborted") {
        throw error;
      }
      if (error instanceof LedgerFileAdapterError && error.stage === "readback") {
        throw error;
      }
      throw new LedgerFileAdapterError(
        "readback",
        "Could not read the ledger file after positioned writes",
        error,
      );
    } finally {
      signal?.removeEventListener("abort", abortWritable);
    }
  }

  private assertLedgerFileExtension(handle: LedgerFileHandle): void {
    if (!handle.name.toLowerCase().endsWith(".lftl")) {
      throw new LedgerFileAdapterError(
        "extension",
        "Selected file must use the .lftl extension",
      );
    }
  }

  private getPickerProvider(): LedgerFilePickerProvider {
    if (this.pickerProvider) {
      return this.pickerProvider;
    }

    const candidate = globalThis as typeof globalThis &
      Partial<LedgerFilePickerProvider>;
    if (
      typeof candidate.showOpenFilePicker !== "function" ||
      typeof candidate.showSaveFilePicker !== "function"
    ) {
      throw new LedgerFileAdapterError(
        "picker",
        "File System Access API is unavailable",
      );
    }

    return candidate as LedgerFilePickerProvider;
  }
}

function assertPermissionState(
  value: unknown,
  stage: "permission-query" | "permission-request",
): LedgerFilePermissionState {
  if (value === "granted" || value === "prompt" || value === "denied") {
    return value;
  }
  throw new LedgerFileAdapterError(
    stage,
    "File permission API returned an invalid state",
  );
}

function assertValidBinaryPatches(
  patches: readonly LedgerFileBinaryPatch[],
  expectedFileByteLength: number,
): void {
  if (
    !Number.isSafeInteger(expectedFileByteLength) ||
    expectedFileByteLength < 1 ||
    expectedFileByteLength > LEDGER_FILE_OUTER_V3_CONSTANTS.maximumFileBytes ||
    patches.length === 0
  ) {
    throw new LedgerFileAdapterError(
      "size",
      "Positioned ledger file write bounds are invalid",
    );
  }
  const ordered = patches
    .map((patch) => ({
      start: patch.position,
      end: patch.position + patch.data.byteLength,
    }))
    .sort((left, right) => left.start - right.start);
  for (const [index, range] of ordered.entries()) {
    if (
      !Number.isSafeInteger(range.start) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end > expectedFileByteLength ||
      (index > 0 && ordered[index - 1]!.end > range.start)
    ) {
      throw new LedgerFileAdapterError(
        "size",
        "Positioned ledger file write bounds are invalid",
      );
    }
  }
}

async function bestEffortAbort(
  writable: LedgerFileWritable,
  reason: unknown,
): Promise<void> {
  if (!writable.abort) {
    return;
  }

  try {
    await writable.abort(reason);
  } catch {
    // 为什么不管这个错：写或关上时的那个错才是要报的。
    // 出处：这是猜的，日志里没写，要核。
  }
}

function assertWriteNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw new LedgerFileAdapterError(
    "aborted",
    "Ledger file write was cancelled before verification completed",
    signal.reason,
  );
}

function isPickerCancellation(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
  );
}
