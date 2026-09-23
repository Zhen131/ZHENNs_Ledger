export const HEADER_KEYS = [
  "backupFormatVersion",
  "crypto",
  "cryptoVersion",
  "current",
  "fileFormatVersion",
  "fileId",
  "ledgerSchemaVersion",
  "previous",
] as const;
export const GENERATION_HEADER_KEYS = [
  "ciphertextByteLength",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
export const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
export const KDF_KEYS = [
  "hash",
  "iterations",
  "name",
  "saltBase64Url",
] as const;
export const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;
export const GENERATION_KEYS = [
  "ciphertextBytes",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
