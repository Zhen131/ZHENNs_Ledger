/**
 * 这个文件管查整本账本时，一条手续费规则对不对。
 * 它不管规则之间的替换关系，那在 ledgerDataValidatorIntegrity.ts。
 * 不显然的决定：规则的币种只认 USDT，比例不含手续费本身。2026-08-10 定（W12 02A 第 5.1 节）。
 */

import type { Asset, FeeRule } from "@/core/models";
import {
  readEntityRecord,
  readRequiredString,
  readTechnicalId,
  readOptionalTechnicalId,
  readPersistedString,
  readAssetSymbol,
  readTechnicalTimestamp,
  readOptionalTechnicalTimestamp,
  validateTimestampOrder,
  readCanonicalDecimal,
  checkAllowedKeys,
  createError,
} from "./ledgerDataValidatorReaders";
import type { LedgerDataValidationError } from "./ledgerDataValidatorSchema";
import {
  LEDGER_DATA_VALIDATION_ERROR_CODES,
  FEE_RULE_BASE_KEYS,
  FIXED_FEE_RULE_KEYS,
  PERCENTAGE_FEE_RULE_KEYS,
} from "./ledgerDataValidatorSchema";

/**
 * 这个函数读出第几条手续费规则，读不对就记错并答没有。
 * 规则分固定金额和按比例两种，金额或比例都不能是负数。
 * 在用的规则不许有停用时间，停用的必须有。
 * 举例：按比例、比例 0.001、在用、没有停用时间 → 答通过。
 * 举例：状态是停用、却没有停用时间 → 答没有，记一条错。
 * 不抛错，错误放进传进来的列表。
 */
export function readFeeRule(
  value: unknown,
  index: number,
  assets: readonly Asset[],
  errors: LedgerDataValidationError[],
): FeeRule | undefined {
  const path = `feeRules[${index}]`;
  const record = readEntityRecord(value, path, errors);
  if (!record) return undefined;
  const errorCount = errors.length;
  checkAllowedKeys(
    record,
    record.type === "fixed"
      ? FIXED_FEE_RULE_KEYS
      : record.type === "percentage"
        ? PERCENTAGE_FEE_RULE_KEYS
        : FEE_RULE_BASE_KEYS,
    path,
    errors,
  );
  const id = readTechnicalId(record.id, `${path}.id`, errors);
  const name = readRequiredString(record.name, `${path}.name`, errors);
  const platform = readPersistedString(
    record.platform,
    `${path}.platform`,
    errors,
  );
  const assetSymbol = readAssetSymbol(
    record.assetSymbol,
    `${path}.assetSymbol`,
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
  const deactivatedAt = readOptionalTechnicalTimestamp(
    record.deactivatedAt,
    `${path}.deactivatedAt`,
    errors,
  );
  const replacesFeeRuleId = readOptionalTechnicalId(
    record.replacesFeeRuleId,
    `${path}.replacesFeeRuleId`,
    errors,
  );
  validateTimestampOrder(createdAt, updatedAt, `${path}.updatedAt`, errors);
  if (
    assetSymbol !== undefined &&
    !assets.some(({ symbol }) => symbol === assetSymbol)
  ) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_REFERENCE,
        `${path}.assetSymbol`,
        `Unknown asset: ${assetSymbol}`,
      ),
    );
  }
  const status =
    record.status === "active" || record.status === "inactive"
      ? record.status
      : undefined;
  if (status === undefined) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.status`,
        "Fee rule status must be active or inactive",
      ),
    );
  }
  if (status === "active" && deactivatedAt !== undefined) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.deactivatedAt`,
        "An active fee rule cannot have deactivatedAt",
      ),
    );
  }
  if (status === "inactive" && deactivatedAt === undefined) {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.deactivatedAt`,
        "An inactive fee rule must have deactivatedAt",
      ),
    );
  }
  if (record.currency !== "USDT") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.currency`,
        "Fee rule currency must be USDT",
      ),
    );
  }
  const amount =
    record.type === "fixed"
      ? readCanonicalDecimal(
          record.amount,
          `${path}.amount`,
          errors,
          "non-negative",
        )
      : undefined;
  const rate =
    record.type === "percentage"
      ? readCanonicalDecimal(
          record.rate,
          `${path}.rate`,
          errors,
          "non-negative",
        )
      : undefined;
  if (record.type !== "fixed" && record.type !== "percentage") {
    errors.push(
      createError(
        LEDGER_DATA_VALIDATION_ERROR_CODES.INVALID_ENTITY,
        `${path}.type`,
        "Fee rule type must be fixed or percentage",
      ),
    );
  }
  if (
    errors.length !== errorCount ||
    id === undefined ||
    name === undefined ||
    platform === undefined ||
    assetSymbol === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    status === undefined ||
    (record.type === "fixed" && amount === undefined) ||
    (record.type === "percentage" && rate === undefined)
  ) {
    return undefined;
  }
  const common = {
    id,
    name,
    platform,
    assetSymbol,
    status: status as FeeRule["status"],
    createdAt,
    updatedAt,
    ...(deactivatedAt === undefined ? {} : { deactivatedAt }),
    ...(replacesFeeRuleId === undefined ? {} : { replacesFeeRuleId }),
  };
  return record.type === "fixed"
    ? { ...common, type: "fixed", amount: amount!, currency: "USDT" }
    : { ...common, type: "percentage", rate: rate!, currency: "USDT" };
}
