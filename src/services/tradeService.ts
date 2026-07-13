import type {
  ISODateTimeString,
  LedgerData,
  Trade,
} from "../models";
import {
  type TradeValidationError,
  validateTradeDraft,
} from "../validators/tradeValidator";

const MAX_TRADE_ID_GENERATION_ATTEMPTS = 3;

export const TRADE_SERVICE_ERROR_CODES = {
  ID_GENERATION_EXHAUSTED: "TRADE_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "TRADE_DEPENDENCY_FAILURE",
} as const;

export type TradeServiceDependencies = {
  generateId: () => string;
  now: () => ISODateTimeString;
};

export type TradeServiceOperationalError =
  | {
      code: "TRADE_ID_GENERATION_EXHAUSTED";
      message: string;
    }
  | {
      code: "TRADE_DEPENDENCY_FAILURE";
      operation: "generateId" | "now";
      message: string;
    };

export type CreateTradeResult =
  | {
      ok: true;
      trade: Trade;
    }
  | {
      ok: false;
      kind: "validation";
      errors: TradeValidationError[];
    }
  | {
      ok: false;
      kind: "service";
      error: TradeServiceOperationalError;
    };

const defaultDependencies: TradeServiceDependencies = {
  generateId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export function createValidatedTrade(
  input: unknown,
  ledgerData: LedgerData,
  dependencies: TradeServiceDependencies = defaultDependencies,
): CreateTradeResult {
  const validationResult = validateTradeDraft(input, {
    assets: ledgerData.assets,
    priorTrades: ledgerData.trades,
  });

  if (!validationResult.ok) {
    return {
      ok: false,
      kind: "validation",
      errors: validationResult.errors,
    };
  }

  const existingTradeIds = new Set(
    ledgerData.trades.map((trade) => trade.id),
  );
  let id: string | undefined;

  for (
    let attempt = 0;
    attempt < MAX_TRADE_ID_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    let candidateId: string;

    try {
      candidateId = dependencies.generateId();
    } catch {
      return dependencyFailure("generateId");
    }

    if (!existingTradeIds.has(candidateId)) {
      id = candidateId;
      break;
    }
  }

  if (id === undefined) {
    return {
      ok: false,
      kind: "service",
      error: {
        code: TRADE_SERVICE_ERROR_CODES.ID_GENERATION_EXHAUSTED,
        message: "Could not generate a unique trade ID after 3 attempts",
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
    trade: {
      ...validationResult.value,
      id,
      feeCurrency:
        validationResult.value.feeCurrency ?? validationResult.value.currency,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function dependencyFailure(
  operation: "generateId" | "now",
): CreateTradeResult {
  return {
    ok: false,
    kind: "service",
    error: {
      code: TRADE_SERVICE_ERROR_CODES.DEPENDENCY_FAILURE,
      operation,
      message: `Trade dependency failed during ${operation}`,
    },
  };
}
