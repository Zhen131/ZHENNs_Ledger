import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import { isValidISODateOrDateTime } from "@/core/validation";
import { selectLedgerDataFacts, validateLedgerData } from "@/core/validation";
import type {
  DecryptedLedgerPayloadV4,
  LedgerFilePayloadValidationResult,
} from "./ledgerFileContract";
import { PAYLOAD_KEYS, LEDGER_DATA_KEYS } from "./ledgerFileContractConstants";
import { isExactObject, failure } from "./ledgerFileContractShared";

export function createCanonicalLedgerPayloadV4(
  ledgerData: unknown,
  savedAt: string,
): LedgerFilePayloadValidationResult {
  if (
    !savedAt.includes("T") ||
    !isValidISODateOrDateTime(savedAt)
  ) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "savedAt",
      "savedAt must be a strict ISO datetime with timezone",
    );
  }

  const ledgerResult = validateLedgerData(selectLedgerDataFacts(ledgerData));
  if (!ledgerResult.ok) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "ledgerData",
      "LedgerData failed runtime validation",
      ledgerResult.errors,
    );
  }

  const resourceResult = evaluateLedgerResourcePolicy(ledgerResult.value);
  if (!resourceResult.ok) {
    return failure(
      "LEDGER_FILE_RESOURCE_POLICY_FAILED",
      "ledgerData",
      "LedgerData exceeds collection or string resource limits",
      resourceResult.errors,
    );
  }

  const value: DecryptedLedgerPayloadV4 = {
    savedAt,
    ledgerData: ledgerResult.value,
  };
  const serializedLedgerData = JSON.stringify(ledgerResult.value);
  const serializedPayload = JSON.stringify(value);
  const byteResult =
    evaluateLedgerFilePayloadByteLength(serializedPayload);

  if (!byteResult.ok) {
    return failure(
      "LEDGER_FILE_RESOURCE_POLICY_FAILED",
      "payload",
      "Ledger file generation payload exceeds the 8 MiB limit",
      byteResult.errors,
    );
  }

  return {
    ok: true,
    value: {
      value,
      serializedPayload,
      serializedLedgerData,
    },
  };
}

export function evaluateLedgerFilePayloadByteLength(
  serializedPayload: string,
) {
  return evaluateLedgerJsonResourcePolicy(serializedPayload);
}

export function validateDecryptedLedgerPayloadV4(
  input: unknown,
): LedgerFilePayloadValidationResult {
  if (
    !isExactObject(input, PAYLOAD_KEYS) ||
    !isExactObject(input.ledgerData, LEDGER_DATA_KEYS) ||
    typeof input.savedAt !== "string"
  ) {
    return failure(
      "LEDGER_FILE_INVALID_PAYLOAD",
      "payload",
      "Decrypted payload must contain exactly savedAt and LedgerData facts",
    );
  }

  return createCanonicalLedgerPayloadV4(input.ledgerData, input.savedAt);
}
