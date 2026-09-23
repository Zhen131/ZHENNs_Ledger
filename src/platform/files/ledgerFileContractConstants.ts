export const FILE_KEYS = [
  "crypto",
  "current",
  "fileFormatVersion",
  "fileId",
  "previous",
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
  "ciphertextBase64Url",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
export const PAYLOAD_KEYS = ["ledgerData", "savedAt"] as const;
export const LEDGER_DATA_KEYS = [
  "assetTransfers",
  "assets",
  "cashEvents",
  "feeRules",
  "priceSnapshots",
  "schemaVersion",
  "trades",
] as const;
