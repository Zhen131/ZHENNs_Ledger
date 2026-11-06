/**
 * 这个文件管和浏览器文件功能打交道时约定的形状。
 * 包括文件把手、写入器、选文件框、出错。
 * 它不管怎么用这些功能，那在 ledgerFileHandleAdapter.ts。
 * 没有特别的决定。
 */

/** 读出来的文字和它占多少字节。 */
export type LedgerFileReadResult = {
  text: string;
  byteLength: number;
};

/** 读出来的原始字节和它占多少字节。 */
export type LedgerFileBytesReadResult = {
  bytes: Uint8Array;
  byteLength: number;
};

/** 选文件框的结果：选中了一个文件，或者取消了。 */
export type LedgerFilePickerResult =
  | { status: "selected"; handle: LedgerFileHandle }
  | { status: "cancelled" };

/** 要什么权限：只读，或读写。 */
export type LedgerFilePermissionMode = "read" | "readwrite";
/** 浏览器答的权限状态：给了、要问、拒绝了。 */
export type LedgerFilePermissionState = "granted" | "prompt" | "denied";

/** 这个类型是读文件时要用到的那一小部分：大小和全部字节。 */
export interface LedgerFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** 这个类型是往文件里写的那个写入器：写、关上、放弃。 */
export interface LedgerFileWritable {
  write(data: LedgerFileWritableData): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

/** 一次指定位置的写入：从第几个字节开始写哪些字节。 */
export type LedgerFilePositionedWrite = {
  type: "write";
  position: number;
  data: Uint8Array;
};

/** 一处局部写入：位置和字节，不带种类标记。 */
export type LedgerFileBinaryPatch = Omit<
  LedgerFilePositionedWrite,
  "type"
>;

/** 写入器能收的三种东西：文字、字节、指定位置的写入。 */
export type LedgerFileWritableData =
  | string
  | Uint8Array
  | LedgerFilePositionedWrite;

/**
 * 这个类型是浏览器给的文件把手。
 * 包括名字、读、写、比是不是同一个文件、问和要权限。
 */
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

/**
 * 这个类型是浏览器的两个选文件框。
 * 包括存新文件、打开已有文件。测试里可以换掉。
 */
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

type LedgerFileAdapterErrorStage =
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

/**
 * 这个类是读写文件出错时抛的错。
 * 记着出错在哪一步（选文件、读、写、复读等）。
 */
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
