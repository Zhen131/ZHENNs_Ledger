/**
 * 这个文件管存取账本文件时内部记着的几种东西。
 * 有核对过的，也有准备要写的。
 * 它不管怎么写、怎么核，那在 ledgerFileRepositoryWrite.ts 和 ledgerFileRepositoryVerify.ts。
 * 没有特别的决定。
 */

import {
  type CanonicalLedgerPayloadV4,
  type DecryptedLedgerPayloadV4,
} from "./ledgerFileContract";
import {
  type LedgerFileBinaryPatchV3S3,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";
import { type LedgerBlockPayloadV3S3 } from "./ledgerFileChunkingV3";
import {
  type ReadyLedgerClearAuthorization,
  type ReadyLedgerImportAuthorization,
} from "@/platform/persistence";

/**
 * 解密并核对过的一代。
 * 有块的说明、解密后的内容。
 * 还有变成文字的样子和每块的内容。
 */
export type VerifiedGeneration = {
  generation: LedgerGenerationV3S3;
  payload: DecryptedLedgerPayloadV4;
  serializedPayload: string;
  serializedLedgerData: string;
  blockPayloads: ReadonlyMap<string, LedgerBlockPayloadV3S3>;
};

/**
 * 核对过的整份文件：文件本身、这一代、上一代。
 * 还有整份字节、用到的槽和随机数。
 */
export type VerifiedLedgerFile = {
  file: LedgerFileV3S3;
  current: VerifiedGeneration;
  previous: VerifiedGeneration | null;
  serializedFile: Uint8Array;
  reachableBodySlots: readonly number[];
  reachableIvBase64Urls: readonly string[];
};

/**
 * 准备要做的一次保存。
 * 包括基于哪份文件、要写成什么、写完应该读回什么。
 */
export type PendingSaveIntent = {
  key: string;
  baseFile: LedgerFileV3S3;
  baseSerializedFile: Uint8Array;
  baseCurrent: VerifiedGeneration;
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  writeMode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
  expectedCurrent: CanonicalLedgerPayloadV4;
  expectedCurrentBlockPayloads: ReadonlyMap<string, string>;
  expectedReachableBodySlots: readonly number[];
  expectedReachableIvBase64Urls: readonly string[];
  appendedFactId?: string;
};

/** 准备要做的一次恢复：要写成什么、写完应该读回什么。 */
export type PendingRecoveryIntent = {
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  writeMode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
  expectedCurrent: CanonicalLedgerPayloadV4;
  expectedCurrentBlockPayloads: ReadonlyMap<string, string>;
  expectedReachableBodySlots: readonly number[];
  expectedReachableIvBase64Urls: readonly string[];
};

/** 准备要做的一次清空：和保存一样，再带上清空授权。 */
export type PendingClearIntent = PendingSaveIntent & {
  authorization: ReadyLedgerClearAuthorization;
};

/** 准备要做的一次导入替换：和保存一样，再带上导入授权。 */
export type PendingImportIntent = PendingSaveIntent & {
  authorization: ReadyLedgerImportAuthorization;
};
