/**
 * 这个文件管一件事：检查人手填的价格，合格就造出一条。
 * 每栏怎么检查交给 core 的 `validatePriceSnapshotDraft`，这里补上编号和时间。
 * 不显然的决定：新价格只许用 USDT；2026-08-09 定（W12 01A 第 6.1 节）。
 */
import type {
  ISODateTimeString,
  LedgerData,
  PriceSnapshot,
} from "@/core/models";
import {
  isTechnicalId,
  type PriceSnapshotValidationError,
  validatePriceSnapshotDraft,
} from "@/core/validation";
import {
  captureLedgerTime,
  systemLedgerClock,
} from "@/core/shared";

/** 为什么最多试 3 次：2026-08-19 定（W14 01B 第 3.5 节）。 */
const MAX_PRICE_ID_GENERATION_ATTEMPTS = 3;

/** 新建价格时另外两种失败：编号造不出来，或读时刻出错。 */
export const PRICE_SNAPSHOT_SERVICE_ERROR_CODES = {
  ID_GENERATION_EXHAUSTED: "PRICE_SNAPSHOT_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "PRICE_SNAPSHOT_DEPENDENCY_FAILURE",
} as const;

/**
 * 新建价格要用的外部东西：生成编号、读时刻、读今天。
 * 测试时可以换成固定的。
 */
export type PriceSnapshotServiceDependencies = {
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey?: () => string;
};

type CreatePriceSnapshotResult =
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

/**
 * 这个函数回答：这条价格合不合规矩？合规就造出一条。
 * 合规的意思：币在清单里，价格大于 0，用 USDT，不在今天以后。
 * 来源是币安的，还要带上从币安拿来的凭据。
 * 举例：ETH 价格 3500 USDT，日期今天 → 答合规，造出一条价格。
 * 举例：价格填 0 → 答不合规，说价格必须大于 0。
 * 什么时候出错：不抛错，返回 `ok:false`。
 * `kind` 为 `validation` 是填错了，为 `service` 是编号或时刻出错。
 */
export function createValidatedPriceSnapshot(
  input: unknown,
  ledgerData: LedgerData,
  providedDependencies?: PriceSnapshotServiceDependencies,
): CreatePriceSnapshotResult {
  const defaultTimeSnapshot = providedDependencies
    ? undefined
    : captureLedgerTime(systemLedgerClock);
  const dependencies: PriceSnapshotServiceDependencies =
    providedDependencies ?? {
      generateId: () => globalThis.crypto.randomUUID(),
      now: () => defaultTimeSnapshot!.now.toISOString(),
      todayKey: () => defaultTimeSnapshot!.todayKey,
    };
  const validationResult = validatePriceSnapshotDraft(
    input,
    ledgerData.assets,
    {
      todayKey:
        dependencies.todayKey?.() ??
        captureLedgerTime(systemLedgerClock).todayKey,
      requireSupportedValuationCurrency: true,
      requireApiProvenance: true,
      requiredCurrency: "USDT",
    },
  );

  if (!validationResult.ok) {
    return {
      ok: false,
      kind: "validation",
      errors: validationResult.errors,
    };
  }

  const existingIds = new Set(
    [
      ...ledgerData.assets,
      ...ledgerData.trades,
      ...ledgerData.cashEvents,
      ...ledgerData.assetTransfers,
      ...ledgerData.priceSnapshots,
      ...ledgerData.feeRules,
    ].map(({ id }) => id),
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

    if (isTechnicalId(candidateId) && !existingIds.has(candidateId)) {
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
