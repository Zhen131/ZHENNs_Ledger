export type LedgerFileReadResult = {
  text: string;
  byteLength: number;
};

export type LedgerFileBytesReadResult = {
  bytes: Uint8Array;
  byteLength: number;
};

export type LedgerFilePickerResult =
  | { status: "selected"; handle: LedgerFileHandle }
  | { status: "cancelled" };

export type LedgerFilePermissionMode = "read" | "readwrite";
export type LedgerFilePermissionState = "granted" | "prompt" | "denied";

export interface LedgerFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface LedgerFileWritable {
  write(data: LedgerFileWritableData): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export type LedgerFilePositionedWrite = {
  type: "write";
  position: number;
  data: Uint8Array;
};

export type LedgerFileBinaryPatch = Omit<
  LedgerFilePositionedWrite,
  "type"
>;

export type LedgerFileWritableData =
  | string
  | Uint8Array
  | LedgerFilePositionedWrite;

export interface LedgerFileHandle {
  readonly name: string;
  getFile(): Promise<LedgerFileLike>;
  createWritable(options?: {
    keepExistingData?: boolean;
    mode?: "exclusive" | "siloed";
  }): Promise<LedgerFileWritable>;
  isSameEntry(other: LedgerFileHandle): Promise<boolean>;
  queryPermission?(options: {
    mode: LedgerFilePermissionMode;
  }): Promise<LedgerFilePermissionState>;
  requestPermission?(options: {
    mode: LedgerFilePermissionMode;
  }): Promise<LedgerFilePermissionState>;
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
  | "readback"
  | "aborted"
  | "permission-query"
  | "permission-request";

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
