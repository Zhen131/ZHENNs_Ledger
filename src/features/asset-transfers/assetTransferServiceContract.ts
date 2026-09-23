import type {
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
  ISODateTimeString,
  TimePrecision,
} from "@/core/models";

export const ASSET_TRANSFER_REASONS_BY_CATEGORY = {
  internal: ["internal-move"],
  "external-in": ["deposit"],
  "external-out": ["withdrawal"],
  gain: ["airdrop", "interest", "platform-gift"],
} as const satisfies Readonly<
  Record<AssetTransferCategory, readonly AssetTransferReason[]>
>;

export type AssetTransferDraft = Readonly<{
  category: AssetTransferCategory;
  assetSymbol: string;
  reason: AssetTransferReason;
  quantity: string;
  occurredAt: string;
  occurredTimeZone?: string;
  timePrecision?: TimePrecision;
  unitPrice?: string;
  networkFee?: string;
  fromLocation?: CustodyLocation;
  toLocation?: CustodyLocation;
  note?: string;
}>;

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

export type AssetTransferServiceDependencies = Readonly<{
  generateId: () => string;
  now: () => ISODateTimeString;
  todayKey: () => string;
}>;

export type ValidateAssetTransferRemovalResult =
  | { ok: true; assetTransferId: string }
  | { ok: false; error: AssetTransferServiceError };
