/**
 * 这个文件管账本文件约定的形状。
 * 包括加密参数、一代内容、解密后的内容、错误代码。
 * 它不管怎么读写和加密，那在同目录的读写、加密文件里。
 * 不显然的决定：四个版本号各管各的，只升真正变了的那个。2026-08-27 定（W15 版本分层与迁移策略决策记录第一节）。
 */

import type { LedgerData } from "@/core/models";
import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "@/core/validation";

/**
 * 账本文件加密用的固定参数。
 * PBKDF2 加 SHA-256 算 60 万轮，盐 16 字节。
 * AES-GCM 256 位钥匙，每次加密 12 字节随机数。
 * 文件格式 3 也沿用这组加密参数。
 * 为什么是这些数：这是猜的，日志里没写，要核。
 */
export const LEDGER_FILE_OUTER_V2_CONSTANTS = {
  fileFormatVersion: 2,
  cryptoVersion: 1,
  kdfName: "PBKDF2",
  kdfHash: "SHA-256",
  kdfIterations: 600_000,
  saltBytes: 16,
  cipherName: "AES-GCM",
  keyLength: 256,
  ivBytes: 12,
  tagLength: 128,
  minimumCiphertextBytes: 16,
  maximumCiphertextBytes:
    DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes + 16,
  maximumTechnicalIdLength: DEFAULT_LEDGER_RESOURCE_LIMITS.id,
} as const;

/**
 * 现在认的账本结构版本：5。低于 5 的一律拒绝，不迁移。
 * 为什么拒绝：Alpha 阶段不做迁移。2026-08-27 定（W15 版本分层与迁移策略决策记录第三节）。
 */
export const SUPPORTED_LEDGER_SCHEMA_VERSION = 5 as const;

/**
 * 一个账本文件最大多少字节：384 MiB。
 * 为什么是这个数：这是猜的，日志里没写，要核。
 */
export const MAX_LEDGER_FILE_V2_BYTES = 384 * 1024 * 1024;

/**
 * 写在文件明文外层的加密参数。
 * 包括版本、算钥匙的办法、加密算法。
 */
export type LedgerFileCryptoV2 = {
  cryptoVersion: 1;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: 600000;
    saltBase64Url: string;
  };
  cipher: {
    name: "AES-GCM";
    keyLength: 256;
    tagLength: 128;
  };
};

/**
 * 老格式里的一代加密内容。
 * 包括版本编号、上一代编号、结构版本、随机数和密文。
 */
export type EncryptedLedgerGenerationV4 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 5;
  ivBase64Url: string;
  ciphertextBase64Url: string;
};

/**
 * 文件格式版本 2 的整份文件。
 * 包括编号、加密参数、这一代、上一代。
 */
export type LedgerFileV2 = {
  fileFormatVersion: 2;
  fileId: string;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV4;
  previous: EncryptedLedgerGenerationV4 | null;
};

/** 解密后里面装的东西：保存时间和整本账本。 */
export type DecryptedLedgerPayloadV4 = {
  savedAt: string;
  ledgerData: LedgerData;
};

/**
 * 检查过的解密内容。
 * 连同它变成文字后的样子，供加密和复查用。
 */
export type CanonicalLedgerPayloadV4 = {
  value: DecryptedLedgerPayloadV4;
  serializedPayload: string;
  serializedLedgerData: string;
};

/**
 * 读账本文件时可能报的错误代码。
 * 例如版本不认识、密码参数不对、内容坏了。
 */
export type LedgerFileContractErrorCode =
  | "LEDGER_FILE_INVALID_STRUCTURE"
  | "LEDGER_FILE_UNSUPPORTED_VERSION"
  | "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA"
  | "LEDGER_FILE_RETIRED_LEDGER_SCHEMA_V4"
  | "LEDGER_FILE_INVALID_CRYPTO_PARAMETERS"
  | "LEDGER_FILE_INVALID_ENCODING"
  | "LEDGER_FILE_INVALID_REVISION_CHAIN"
  | "LEDGER_FILE_INVALID_PAYLOAD"
  | "LEDGER_FILE_RESOURCE_POLICY_FAILED";

/** 一条账本文件错误：错误代码、位置、说明，可能还带着原因。 */
export type LedgerFileContractError = {
  code: LedgerFileContractErrorCode;
  path: string;
  message: string;
  cause?: unknown;
};

/**
 * 检查一份版本 2 文件的结果。
 * 通过就给出文件，不通过就给出错误。
 */
export type LedgerFileValidationResult =
  | { ok: true; value: LedgerFileV2 }
  | { ok: false; errors: LedgerFileContractError[] };

/**
 * 检查解密内容的结果。
 * 通过就给出整理好的内容，不通过就给出错误。
 */
export type LedgerFilePayloadValidationResult =
  | { ok: true; value: CanonicalLedgerPayloadV4 }
  | { ok: false; errors: LedgerFileContractError[] };
