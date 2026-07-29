import { MAX_LEDGER_FILE_V1_BYTES } from "../encryption/ledgerFileContract";

export type LedgerFileReadResult = {
  text: string;
  byteLength: number;
};

export type LedgerFilePickerResult =
  | { status: "selected"; handle: LedgerFileHandle }
  | { status: "cancelled" };

export interface LedgerFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface LedgerFileWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface LedgerFileHandle {
  readonly name: string;
  getFile(): Promise<LedgerFileLike>;
  createWritable(options?: {
    keepExistingData?: boolean;
  }): Promise<LedgerFileWritable>;
}

export interface LedgerFilePickerProvider {
  showSaveFilePicker(options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption: boolean;
  }): Promise<LedgerFileHandle>;
  showOpenFilePicker(options: {
    multiple: false;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
    excludeAcceptAllOption: boolean;
  }): Promise<LedgerFileHandle[]>;
}

export type LedgerFileAdapterErrorStage =
  | "picker"
  | "extension"
  | "target"
  | "get-file"
  | "size"
  | "array-buffer"
  | "utf8"
  | "create-writable"
  | "write"
  | "close"
  | "readback";

export class LedgerFileAdapterError extends Error {
  constructor(
    readonly stage: LedgerFileAdapterErrorStage,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LedgerFileAdapterError";
  }
}

const FILE_PICKER_TYPES = [
  {
    description: "Local-First Trading Ledger",
    accept: {
      "application/json": [".lftl"],
    },
  },
];

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
        excludeAcceptAllOption: true,
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

    if (file.size > MAX_LEDGER_FILE_V1_BYTES) {
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

    if (buffer.byteLength > MAX_LEDGER_FILE_V1_BYTES) {
      throw new LedgerFileAdapterError(
        "size",
        "Ledger file bytes exceed the 32 MiB outer limit",
      );
    }

    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
        byteLength: buffer.byteLength,
      };
    } catch (error) {
      throw new LedgerFileAdapterError(
        "utf8",
        "Ledger file is not valid UTF-8",
        error,
      );
    }
  }

  async writeAndReadBack(
    handle: LedgerFileHandle,
    serializedFile: string,
  ): Promise<LedgerFileReadResult> {
    this.assertLedgerFileExtension(handle);
    const byteLength = new TextEncoder().encode(serializedFile).byteLength;
    if (byteLength > MAX_LEDGER_FILE_V1_BYTES) {
      throw new LedgerFileAdapterError(
        "size",
        "Serialized ledger file exceeds the 32 MiB outer limit",
      );
    }

    let writable: LedgerFileWritable;
    try {
      writable = await handle.createWritable({
        keepExistingData: false,
      });
    } catch (error) {
      throw new LedgerFileAdapterError(
        "create-writable",
        "Could not create a ledger file writable stream",
        error,
      );
    }

    try {
      await writable.write(serializedFile);
    } catch (error) {
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "write",
        "Could not write the complete ledger file",
        error,
      );
    }

    try {
      await writable.close();
    } catch (error) {
      await bestEffortAbort(writable, error);
      throw new LedgerFileAdapterError(
        "close",
        "Could not close the ledger file writable stream",
        error,
      );
    }

    try {
      return await this.read(handle);
    } catch (error) {
      throw new LedgerFileAdapterError(
        "readback",
        "Could not read the ledger file after closing the writable stream",
        error,
      );
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
    // The original write/close failure remains the authoritative error.
  }
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
