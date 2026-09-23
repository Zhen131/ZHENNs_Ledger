import type { Asset, PriceSnapshotDraft } from "@/core/models";
import { isLedgerFactInFuture } from "@/core/shared";
import { isSupportedValuationCurrency } from "@/core/policies";
import type {
  PriceSnapshotValidationError,
} from "./priceSnapshotValidatorErrors";
import {
  PRICE_SNAPSHOT_VALIDATION_ERROR_CODES,
} from "./priceSnapshotValidatorErrors";
import {
  readOptionalOccurredTimeZone,
  readBinanceProvenance,
  isRecord,
  readAssetSymbol,
  readPositivePrice,
  readRequiredString,
  readRecordedAt,
  readSource,
  readOptionalNote,
  createError,
} from "./priceSnapshotValidatorReaders";

export type ValidatedPriceSnapshotDraft = Omit<
  PriceSnapshotDraft,
  "currency"
> & {
  currency: "USDT";
};

export type PriceSnapshotValidationResult =
  | {
      ok: true;
      value: ValidatedPriceSnapshotDraft;
    }
  | {
      ok: false;
      errors: PriceSnapshotValidationError[];
    };

export type PriceSnapshotValidationOptions = {
  todayKey?: string;
  requireSupportedValuationCurrency?: boolean;
  requireApiProvenance?: boolean;
  requiredCurrency?: string;
};

export function validatePriceSnapshotDraft(
  input: unknown,
  assets: readonly Asset[],
  options: PriceSnapshotValidationOptions = {},
): PriceSnapshotValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createError(
          PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.INVALID_INPUT,
          "input",
          "Price snapshot draft must be an object",
        ),
      ],
    };
  }

  const errors: PriceSnapshotValidationError[] = [];
  const assetSymbol = readAssetSymbol(input.assetSymbol, assets, errors);
  const price = readPositivePrice(input.price, errors);
  const currency = readRequiredString(input.currency, "currency", errors);
  const recordedAt = readRecordedAt(input.recordedAt, errors);
  const occurredTimeZone = readOptionalOccurredTimeZone(
    input.occurredTimeZone,
    errors,
  );
  const source = readSource(input.source, errors);
  const binanceProvenance = readBinanceProvenance(
    input.binanceProvenance,
    source,
    errors,
  );
  const note = readOptionalNote(input.note, errors);

  if (assetSymbol !== undefined && currency !== undefined) {
    const asset = assets.find((item) => item.symbol === assetSymbol);

    if (asset?.quoteCurrency !== currency) {
      errors.push(
        createError(
          PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.CURRENCY_MISMATCH,
          "currency",
          `currency must match ${assetSymbol} quote currency`,
        ),
      );
    }
  }

  if (
    recordedAt !== undefined &&
    options.todayKey !== undefined &&
    isLedgerFactInFuture(recordedAt, options.todayKey)
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.FUTURE_FACT,
        "recordedAt",
        `recordedAt cannot be later than ${options.todayKey}`,
      ),
    );
  }

  if (
    options.requireSupportedValuationCurrency &&
    currency !== undefined &&
    !isSupportedValuationCurrency(currency)
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.UNSUPPORTED_VALUATION_CURRENCY,
        "currency",
        "V5 supports USDT valuation only",
      ),
    );
  }

  if (currency !== undefined && currency !== "USDT") {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.NEW_FACT_REQUIRES_USDT,
        "currency",
        "New price facts must use USDT",
      ),
    );
  }

  if (
    options.requireApiProvenance &&
    source === "api" &&
    binanceProvenance === undefined
  ) {
    errors.push(
      createError(
        PRICE_SNAPSHOT_VALIDATION_ERROR_CODES.BINANCE_PROVENANCE_REQUIRED,
        "binanceProvenance",
        "Binance API prices require provenance",
      ),
    );
  }

  if (
    errors.length > 0 ||
    assetSymbol === undefined ||
    price === undefined ||
    currency !== "USDT" ||
    recordedAt === undefined ||
    source === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      assetSymbol,
      price,
      currency,
      recordedAt,
      ...(occurredTimeZone === undefined ? {} : { occurredTimeZone }),
      source,
      ...(binanceProvenance === undefined ? {} : { binanceProvenance }),
      ...(note === undefined ? {} : { note }),
    },
  };
}
