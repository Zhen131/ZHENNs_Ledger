import type { Asset, BinanceMarketMapping } from "@/core/models";
import {
  readEntityRecord,
  readRequiredString,
  readBoundedString,
  readTechnicalId,
  readAssetSymbol,
  readUsdt,
  readTechnicalTimestamp,
  validateTimestampOrder,
  readOptionalDecimals,
  checkExactKeys,
  checkAllowedKeys,
  isRecord,
  createError,
} from "./ledgerDataValidatorReaders";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  ASSET_KEYS,
  BINANCE_MAPPING_KEYS,
} from "./ledgerDataValidatorSchema";

export function readAsset(
  value: unknown,
  index: number,
  errors: LedgerDataValidationError[],
): Asset | undefined {
  const path = `assets[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(record, ASSET_KEYS, path, errors);
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const symbol = readAssetSymbol(record.symbol, `${path}.symbol`, errors);
  const name = readRequiredString(record.name, `${path}.name`, errors);
  const quoteCurrency = readUsdt(
    record.quoteCurrency,
    `${path}.quoteCurrency`,
    errors,
  );
  const decimals = readOptionalDecimals(
    record.decimals,
    `${path}.decimals`,
    errors,
  );
  const binanceMapping = readBinanceMapping(
    record.binanceMapping,
    symbol,
    `${path}.binanceMapping`,
    errors,
  );
  const createdAt = readTechnicalTimestamp(
    record.createdAt,
    `${path}.createdAt`,
    errors,
  );
  const updatedAt = readTechnicalTimestamp(
    record.updatedAt,
    `${path}.updatedAt`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);
  if (
    errors.length !== errorCount ||
    id === undefined ||
    symbol === undefined ||
    name === undefined ||
    quoteCurrency === undefined ||
    binanceMapping === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined;
  }
  return {
    id,
    symbol,
    name,
    quoteCurrency,
    ...(decimals === undefined ? {} : { decimals }),
    binanceMapping,
    createdAt,
    updatedAt,
  };
}

function readBinanceMapping(
  value: unknown,
  assetSymbol: string | undefined,
  path: string,
  errors: LedgerDataValidationError[],
): BinanceMarketMapping | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        path,
        `${path} must be null or an explicit Binance mapping`,
      ),
    );
    return undefined;
  }
  const errorCount = errors.length;
  checkExactKeys(value, BINANCE_MAPPING_KEYS, path, errors);
  const symbol = readBoundedString(value.symbol, `${path}.symbol`, 64, errors);
  const baseAsset = readAssetSymbol(
    value.baseAsset,
    `${path}.baseAsset`,
    errors,
  );
  if (value.provider !== "binance") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.provider`,
        "Binance mapping provider must be binance",
      ),
    );
  }
  if (value.quoteAsset !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.quoteAsset`,
        "Binance mapping quote asset must be USDT",
      ),
    );
  }
  if (
    baseAsset !== undefined &&
    assetSymbol !== undefined &&
    baseAsset !== assetSymbol
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.baseAsset`,
        "Binance mapping base asset must match the ledger asset symbol",
      ),
    );
  }
  if (
    errors.length !== errorCount ||
    symbol === undefined ||
    baseAsset === undefined ||
    value.provider !== "binance" ||
    value.quoteAsset !== "USDT" ||
    baseAsset !== assetSymbol
  ) {
    return undefined;
  }
  return { provider: "binance", symbol, baseAsset, quoteAsset: "USDT" };
}
