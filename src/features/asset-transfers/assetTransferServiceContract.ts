/**
 * 这个文件放币的转账要用的几样约定。
 * 有分类和原因的搭配、错误代码、几个类型。
 * 真正检查转账在 `assetTransferService.ts`。
 * 不显然的决定：每种分类只许配固定的几种原因；为什么这样分，这是猜的，要核。
 */
import type {
  AssetTransferCategory,
  AssetTransferReason,
  ISODateTimeString,
} from "@/core/models";

/**
 * 每种转账分类能配哪些原因。
 * 自己挪位置只能是「内部挪动」。
 * 外部转入是「充值」，外部转出是「提币」。
 * 白得的可以是空投、利息、平台赠送。
 */
export const ASSET_TRANSFER_REASONS_BY_CATEGORY = {
  internal: ["internal-move"],
  "external-in": ["deposit"],
  "external-out": ["withdrawal"],
  gain: ["airdrop", "interest", "platform-gift"],
} as const satisfies Readonly<
  Record<AssetTransferCategory, readonly AssetTransferReason[]>
>;

/**
 * 新建或删除一笔转账可能失败的原因，一种一个代码。
 * 界面按代码分支，不去读说明文字。
 */
export const ASSET_TRANSFER_SERVICE_ERROR_CODES = {
  INVALID_INPUT: "ASSET_TRANSFER_INVALID_INPUT",
  INVALID_CATEGORY: "ASSET_TRANSFER_INVALID_CATEGORY",
  INVALID_ASSET: "ASSET_TRANSFER_INVALID_ASSET",
  INVALID_REASON: "ASSET_TRANSFER_INVALID_REASON",
  INVALID_QUANTITY: "ASSET_TRANSFER_INVALID_QUANTITY",
  INVALID_DATE: "ASSET_TRANSFER_INVALID_DATE",
  FUTURE_FACT: "ASSET_TRANSFER_FUTURE_FACT",
  INVALID_UNIT_PRICE: "ASSET_TRANSFER_INVALID_UNIT_PRICE",
  INVALID_NETWORK_FEE: "ASSET_TRANSFER_INVALID_NETWORK_FEE",
  INVALID_FROM_LOCATION: "ASSET_TRANSFER_INVALID_FROM_LOCATION",
  INVALID_TO_LOCATION: "ASSET_TRANSFER_INVALID_TO_LOCATION",
  INVALID_COMBINATION: "ASSET_TRANSFER_INVALID_COMBINATION",
  INVALID_NOTE: "ASSET_TRANSFER_INVALID_NOTE",
  NOTE_TOO_LONG: "ASSET_TRANSFER_NOTE_TOO_LONG",
  INSUFFICIENT_HOLDING: "ASSET_TRANSFER_INSUFFICIENT_HOLDING",
  TRANSFER_NOT_FOUND: "ASSET_TRANSFER_NOT_FOUND",
  REMOVAL_BREAKS_TIMELINE: "ASSET_TRANSFER_REMOVAL_BREAKS_TIMELINE",
  ID_GENERATION_EXHAUSTED: "ASSET_TRANSFER_ID_GENERATION_EXHAUSTED",
  DEPENDENCY_FAILURE: "ASSET_TRANSFER_DEPENDENCY_FAILURE",
  LEDGER_VALIDATION_FAILED: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
} as const;

/** 转账检查失败时的结果：错误代码、挂在哪栏、说明文字。 */
export type AssetTransferServiceError = Readonly<{
  code: (typeof ASSET_TRANSFER_SERVICE_ERROR_CODES)[keyof typeof ASSET_TRANSFER_SERVICE_ERROR_CODES];
  field:
    | "form"
    | "category"
    | "assetSymbol"
    | "reason"
    | "quantity"
    | "occurredAt"
    | "unitPrice"
    | "networkFee"
    | "fromLocation"
    | "toLocation"
    | "note";
  message: string;
}>;

/**
 * 新建转账要用的外部东西：生成编号、读时刻、读今天。
 * 测试时可以换成固定的。
 */
export type AssetTransferServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey: () => string;
}>;

/** 能不能删一笔转账的答案：能删，或者不能删和原因。 */
export type ValidateAssetTransferRemovalResult =
  | { ok: true; assetTransferId: string }
  | { ok: false; error: AssetTransferServiceError };
