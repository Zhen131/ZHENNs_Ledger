import { describe, expect, it } from "vitest";

import { DEFAULT_LEDGER_RESOURCE_LIMITS } from "@/core/validation";
import { bytesToBase64Url } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  SUPPORTED_LEDGER_SCHEMA_VERSION,
  createCanonicalLedgerPayloadV4,
  createLedgerFileCryptoV2,
  createLedgerFileGenerationAadV2,
  evaluateLedgerFilePayloadByteLength,
  type EncryptedLedgerGenerationV4,
  type LedgerFileV2,
  validateDecryptedLedgerPayloadV4,
  validateLedgerFileV2,
} from "./ledgerFileContract";
import { createInitialLedgerData } from "@/core/state";

function createGeneration(
  revisionId: string,
  parentRevisionId: string | null,
  ivByte: number,
): EncryptedLedgerGenerationV4 {
  return {
    revisionId,
    parentRevisionId,
    ledgerSchemaVersion: 4,
    ivBase64Url: bytesToBase64Url(new Uint8Array(12).fill(ivByte)),
    ciphertextBase64Url: bytesToBase64Url(new Uint8Array(16).fill(9)),
  };
}

function createFile(previous = false): LedgerFileV2 {
  const first = createGeneration("revision-a", null, 1);
  return {
    fileFormatVersion: 2,
    fileId: "file-a",
    crypto: createLedgerFileCryptoV2(
      bytesToBase64Url(new Uint8Array(16).fill(7)),
    ),
    current: previous
      ? createGeneration("revision-b", "revision-a", 2)
      : first,
    previous: previous ? first : null,
  };
}

describe("LedgerFileV2 contract", () => {
  it("accepts exact first and two-generation V2 envelopes", () => {
    expect(validateLedgerFileV2(createFile()).ok).toBe(true);
    expect(validateLedgerFileV2(createFile(true)).ok).toBe(true);
  });

  it.each([
    ["retired V1 file version", { fileFormatVersion: 1 }],
    ["unknown file version", { fileFormatVersion: 99 }],
    ["unknown crypto version", { crypto: { cryptoVersion: 2 } }],
    [
      "unknown ledger schema version",
      { current: { ledgerSchemaVersion: 99 } },
    ],
  ])("rejects %s", (_name, change) => {
    const file = createFile();
    const changed = {
      ...file,
      ...change,
      crypto:
        "crypto" in change
          ? { ...file.crypto, ...change.crypto }
          : file.crypto,
      current:
        "current" in change
          ? { ...file.current, ...change.current }
          : file.current,
    };

    expect(validateLedgerFileV2(changed).ok).toBe(false);
  });

  it.each([2, 3] as const)(
    "rejects a V%i ledger before any ciphertext handling",
    (ledgerSchemaVersion) => {
      const file = createFile();
      const result = validateLedgerFileV2({
        ...file,
        current: { ...file.current, ledgerSchemaVersion },
      });

      expect(result).toEqual({
        ok: false,
        errors: [
          expect.objectContaining({
            code: "LEDGER_FILE_UNSUPPORTED_LEDGER_SCHEMA",
            path: "current.ledgerSchemaVersion",
            message: `This file contains a V${ledgerSchemaVersion} ledger; V4 does not provide migration`,
          }),
        ],
      });
    },
  );

  it("rejects missing, extra, non-canonical Base64URL, and invalid revision relationships", () => {
    const file = createFile(true);
    const missing: Partial<LedgerFileV2> = { ...file };
    delete missing.previous;

    expect(validateLedgerFileV2(missing).ok).toBe(false);
    expect(
      validateLedgerFileV2({ ...file, businessName: "BTC ledger" }),
    ).toMatchObject({ ok: false });
    expect(
      validateLedgerFileV2({
        ...file,
        crypto: {
          ...file.crypto,
          kdf: { ...file.crypto.kdf, saltBase64Url: "AQ==" },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateLedgerFileV2({
        ...file,
        current: {
          ...file.current,
          parentRevisionId: "not-the-previous-revision",
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateLedgerFileV2({
        ...file,
        current: {
          ...file.current,
          ivBase64Url: file.previous?.ivBase64Url,
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("builds deterministic AAD from every authenticated technical field", () => {
    const file = createFile(true);
    const generation = {
      revisionId: file.current.revisionId,
      parentRevisionId: file.current.parentRevisionId,
      ledgerSchemaVersion: file.current.ledgerSchemaVersion,
      ivBase64Url: file.current.ivBase64Url,
    };
    const aad = new TextDecoder().decode(
      createLedgerFileGenerationAadV2(file, generation),
    );

    expect(JSON.parse(aad)).toEqual({
      fileFormatVersion: 2,
      fileId: "file-a",
      crypto: {
        cryptoVersion: 1,
        kdf: {
          name: "PBKDF2",
          hash: "SHA-256",
          iterations: 600000,
          saltBase64Url: file.crypto.kdf.saltBase64Url,
        },
        cipher: {
          name: "AES-GCM",
          keyLength: 256,
          tagLength: 128,
        },
      },
      generation: {
        revisionId: "revision-b",
        parentRevisionId: "revision-a",
        ledgerSchemaVersion: 4,
        ivBase64Url: file.current.ivBase64Url,
      },
    });
    expect(aad).not.toContain("BTC");
    expect(aad).not.toContain("ciphertextBase64Url");
  });

  it("canonicalizes only savedAt and the six LedgerData fact collections", () => {
    const ledger = {
      ...createInitialLedgerData(),
      positions: [{ assetSymbol: "BTC" }],
      chartData: { fake: true },
    };
    const result = createCanonicalLedgerPayloadV4(
      ledger,
      "2026-07-28T10:00:00.000Z",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.serializedPayload)).toEqual({
      savedAt: "2026-07-28T10:00:00.000Z",
      ledgerData: createInitialLedgerData(),
    });
    expect(result.value.serializedPayload).not.toContain("positions");
    expect(result.value.serializedPayload).not.toContain("chartData");
  });

  it("requires an exact decrypted payload and matching supported schema", () => {
    const payload = {
      savedAt: "2026-07-28T10:00:00.000Z",
      ledgerData: createInitialLedgerData(),
    };

    expect(validateDecryptedLedgerPayloadV4(payload).ok).toBe(true);
    expect(
      validateDecryptedLedgerPayloadV4({ ...payload, uiState: {} }),
    ).toMatchObject({ ok: false });
    expect(
      validateDecryptedLedgerPayloadV4({
        ...payload,
        ledgerData: { ...payload.ledgerData, kline: [] },
      }),
    ).toMatchObject({ ok: false });
    expect(
      createCanonicalLedgerPayloadV4(
        payload.ledgerData,
        "2026-07-28",
      ),
    ).toMatchObject({ ok: false });
  });

  it("keeps the file and IndexedDB version systems independent", async () => {
    const { LEDGER_CRYPTO_CONSTANTS } = await import("@/platform/legacy");

    expect(LEDGER_FILE_OUTER_V2_CONSTANTS.fileFormatVersion).toBe(2);
    expect(LEDGER_CRYPTO_CONSTANTS.formatVersion).toBe(2);
    expect(SUPPORTED_LEDGER_SCHEMA_VERSION).toBe(4);
    expect(LEDGER_CRYPTO_CONSTANTS.ledgerSchemaVersion).toBe(1);
    expect(validateLedgerFileV2(createFile()).ok).toBe(true);
  });

  it("accepts the configured generation plaintext limit and rejects one extra byte", () => {
    const exact = "x".repeat(DEFAULT_LEDGER_RESOURCE_LIMITS.fileBytes);

    expect(evaluateLedgerFilePayloadByteLength(exact)).toEqual({
      ok: true,
    });
    expect(
      evaluateLedgerFilePayloadByteLength(`${exact}x`),
    ).toMatchObject({ ok: false });
  });
});
