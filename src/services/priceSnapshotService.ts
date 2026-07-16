import type {
  ISODateTimeString,
  LedgerData,
  PriceSnapshot,
} from "../models";
import {
  type PriceSnapshotValidationError,
  validatePriceSnapshotDraft,
} from "../validators/priceSnapshotValidator";

const MAX_PRICE_ID_GENERATION_ATTEMPTS = 3;

export const PRICE_SNAPSHOT_SERVICE_ERROR_CODES = {
  ID_GENERATION_EXHAUSTED: "PRICE_SNAPSHOT_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "PRICE_SNAPSHOT_DEPENDENCY_FAILURE",
} as const;

export type PriceSnapshotServiceDependencies = {
  generateId: () => string;
  now: () => ISODateTimeString;
};

export type CreatePriceSnapshotResult =
  | {
      ok: true;
      priceSnapshot: PriceSnapshot;
    }
  | {
      ok: false;
      kind: "validation";
      errors: PriceSnapshotValidationError[];
    }
  | {
      ok: false;
      kind: "service";
      error: {
        code:
          | "PRICE_SNAPSHOT_ID_GENERATION_EXHAUSTED"
          | "PRICE_SNAPSHOT_DEPENDENCY_FAILURE";
        operation?: "generateId" | "now";
        message: string;
      };
    };

const defaultDependencies: PriceSnapshotServiceDependencies = {
  generateId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export function createValidatedPriceSnapshot(
  input: unknown,
  ledgerData: LedgerData,
  dependencies: PriceSnapshotServiceDependencies = defaultDependencies,
): CreatePriceSnapshotResult {
  const validationResult = validatePriceSnapshotDraft(
    input,
    ledgerData.assets,
  );

  if (!validationResult.ok) {
    return {
      ok: false,
      kind: "validation",
      errors: validationResult.errors,
    };
  }

  const existingIds = new Set(
    ledgerData.priceSnapshots.map((snapshot) => snapshot.id),
  );
  let id: string | undefined;

  for (
    let attempt = 0;
    attempt < MAX_PRICE_ID_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    let candidateId: string;

    try {
      candidateId = dependencies.generateId();
    } catch {
      return dependencyFailure("generateId");
    }

    if (!existingIds.has(candidateId)) {
      id = candidateId;
      break;
    }
  }

  if (id === undefined) {
    return {
      ok: false,
      kind: "service",
      error: {
        code: PRICE_SNAPSHOT_SERVICE_ERROR_CODES.ID_GENERATION_EXHAUSTED,
        message: "Could not generate a unique price snapshot ID after 3 attempts",
      },
    };
  }

  let timestamp: ISODateTimeString;

  try {
    timestamp = dependencies.now();
  } catch {
    return dependencyFailure("now");
  }

  return {
    ok: true,
    priceSnapshot: {
      ...validationResult.value,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function dependencyFailure(
  operation: "generateId" | "now",
): CreatePriceSnapshotResult {
  return {
    ok: false,
    kind: "service",
    error: {
      code: PRICE_SNAPSHOT_SERVICE_ERROR_CODES.DEPENDENCY_FAILURE,
      operation,
      message: `Price snapshot dependency failed during ${operation}`,
    },
  };
}
