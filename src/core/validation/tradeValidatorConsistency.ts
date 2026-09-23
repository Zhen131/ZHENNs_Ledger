import type { Asset, AssetTransfer, DecimalString, Trade } from "@/core/models";
import { replayPositions } from "@/core/calculations";
import { isWithinTolerance, multiply } from "@/core/shared";
import type { TradeValidationError } from "./tradeValidatorErrors";
import {
  TRADE_VALIDATION_ERROR_CODES,
  createError,
} from "./tradeValidatorErrors";

export function validateTotalValueConsistency(
  quantity: DecimalString,
  price: DecimalString,
  totalValue: DecimalString,
  tolerance: DecimalString,
  errors: TradeValidationError[],
): void {
  try {
    const calculatedTotalValue = multiply(quantity, price);

    if (!isWithinTolerance(calculatedTotalValue, totalValue, tolerance)) {
      errors.push(
        createError(
          TRADE_VALIDATION_ERROR_CODES.TOTAL_VALUE_MISMATCH,
          "totalValue",
          `quantity × price is ${calculatedTotalValue}, but totalValue is ${totalValue}; allowed difference is ${tolerance}`,
        ),
      );
    }
  } catch {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.INVALID_DECIMAL,
        "totalValueTolerance",
        "totalValueTolerance must be a valid non-negative finite decimal string",
      ),
    );
  }
}

export function validateCurrencyConsistency(
  assetSymbol: string,
  currency: string,
  assets: readonly Asset[],
  priorTrades: readonly Trade[],
  errors: TradeValidationError[],
): void {
  const asset = assets.find((item) => item.symbol === assetSymbol);
  const hasPriorCurrencyMismatch = priorTrades.some(
    (trade) =>
      trade.assetSymbol === assetSymbol && trade.currency !== currency,
  );

  if (asset?.quoteCurrency !== currency || hasPriorCurrencyMismatch) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
        "currency",
        `currency must match ${assetSymbol} quote currency and existing trades`,
      ),
    );
  }
}

/**
 * Reuse the canonical merged position replay so a transfer-supported sell is
 * accepted and exchange-location shortages are rejected. The synthetic
 * technical timestamp places the draft after existing same-occurrence facts;
 * tradeService replays once more with the final persisted ID and timestamp.
 */
export function validateHoldingsTimeline(
  candidate: Trade,
  priorTrades: readonly Trade[],
  priorAssetTransfers: readonly AssetTransfer[],
  errors: TradeValidationError[],
): void {
  try {
    replayPositions([...priorTrades, candidate], priorAssetTransfers);
  } catch (error) {
    errors.push(
      createError(
        TRADE_VALIDATION_ERROR_CODES.INSUFFICIENT_HOLDINGS,
        "quantity",
        error instanceof Error
          ? error.message
          : `Adding this trade would invalidate the ${candidate.assetSymbol} holdings timeline`,
      ),
    );
  }
}
