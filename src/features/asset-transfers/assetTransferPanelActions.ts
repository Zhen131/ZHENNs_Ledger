import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  FormEvent,
  SetStateAction,
} from "react";
import type { AssetTransferServiceError } from "./assetTransferService";
import type { useLanguage } from "@/ui";
import type {
  AssetTransfer,
  AssetTransferCategory,
  AssetTransferReason,
  CustodyLocation,
  LedgerData,
} from "@/core/models";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import {
  captureLedgerTime,
  resolveFactMoment,
} from "@/core/shared";
import { createValidatedAssetTransfer } from "./assetTransferService";

type TransferPersistenceEffectDeps = {
  deletedFeedback: string;
  pendingMutationVersion: number | null;
  pendingOperation: "add" | "delete" | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  savedFeedback: string;
  setError: Dispatch<SetStateAction<AssetTransferServiceError | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setNetworkFee: Dispatch<SetStateAction<string>>;
  setNote: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  setQuantity: Dispatch<SetStateAction<string>>;
  setUnitPrice: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runTransferPersistenceEffect(
  deps: TransferPersistenceEffectDeps,
) {
  const {
    deletedFeedback,
    pendingMutationVersion,
    pendingOperation,
    persistedVersion,
    persistenceStatus,
    savedFeedback,
    setError,
    setFeedback,
    setNetworkFee,
    setNote,
    setPendingMutationVersion,
    setPendingOperation,
    setQuantity,
    setUnitPrice,
    t,
  } = deps;
    if (pendingMutationVersion === null) return;
    if (persistenceStatus === "error") {
      setError({
        code: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
        field: "form",
        message: t("assetTransfers.status.unsaved"),
      });
      return;
    }
    if (
      persistenceStatus === "saved" &&
      persistedVersion >= pendingMutationVersion
    ) {
      if (pendingOperation === "add") {
        setQuantity("");
        setUnitPrice("");
        setNetworkFee("");
        setNote("");
        setFeedback(savedFeedback);
      } else {
        setFeedback(deletedFeedback);
      }
      setError(null);
      setPendingMutationVersion(null);
      setPendingOperation(null);
    }
}

type HandleSubmitDeps = {
  assetSymbol: string;
  category: AssetTransferCategory;
  clock: LedgerClock;
  disabled: boolean;
  fromLocation: CustodyLocation;
  ledgerData: LedgerData;
  mutationVersion: number;
  networkFee: string;
  note: string;
  occurredAt: string;
  occurredTime: string;
  occurredTimeZone: string;
  onAssetTransferCreated: (assetTransfer: AssetTransfer, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  quantity: string;
  reason: AssetTransferReason;
  setError: Dispatch<SetStateAction<AssetTransferServiceError | null>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setPendingOperation: Dispatch<SetStateAction<"add" | "delete" | null>>;
  t: ReturnType<typeof useLanguage>["t"];
  toLocation: CustodyLocation;
  unitPrice: string;
};

export function doHandleSubmit(
  deps: HandleSubmitDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    assetSymbol,
    category,
    clock,
    disabled,
    fromLocation,
    ledgerData,
    mutationVersion,
    networkFee,
    note,
    occurredAt,
    occurredTime,
    occurredTimeZone,
    onAssetTransferCreated,
    quantity,
    reason,
    setError,
    setFeedback,
    setPendingMutationVersion,
    setPendingOperation,
    t,
    toLocation,
    unitPrice,
  } = deps;
    event.preventDefault();
    if (disabled) return;
    const timeSnapshot = captureLedgerTime(clock);
    const moment = resolveFactMoment(occurredAt, occurredTime, occurredTimeZone);
    if (!moment.ok) {
      setError({
        code: "ASSET_TRANSFER_INVALID_DATE",
        field: "occurredAt",
        message: t(
          moment.reason === "nonexistent"
            ? "assetTransfer.validation.nonexistentWallTime"
            : moment.reason === "ambiguous"
              ? "assetTransfer.validation.ambiguousWallTime"
              : "assetTransfer.validation.invalidTimeZone",
        ),
      });
      setFeedback("");
      return;
    }
    const common = {
      category,
      assetSymbol,
      reason,
      quantity,
      ...moment.value,
      note,
    };
    const input =
      category === "internal"
        ? {
            ...common,
            fromLocation,
            toLocation,
            ...(networkFee === "" ? {} : { networkFee }),
          }
        : category === "external-out"
          ? {
              ...common,
              fromLocation,
              ...(networkFee === "" ? {} : { networkFee }),
            }
          : { ...common, toLocation, unitPrice };
    const result = createValidatedAssetTransfer(input, ledgerData, {
      generateId: () => globalThis.crypto.randomUUID(),
      now: () => timeSnapshot.now.toISOString(),
      todayKey: () => timeSnapshot.todayKey,
    });
    if (!result.ok) {
      setError(result.error);
      setFeedback("");
      return;
    }
    const outcome = onAssetTransferCreated(
      result.assetTransfer,
      timeSnapshot,
    );
    if (outcome !== "applied") {
      setError({
        code: "ASSET_TRANSFER_LEDGER_VALIDATION_FAILED",
        field: "form",
        message: outcome === "rejected" ? t("assetTransfers.status.ledgerNotWritable") : t("assetTransfers.status.unchanged"),
      });
      setFeedback("");
      return;
    }
    setPendingMutationVersion(mutationVersion + 1);
    setPendingOperation("add");
    setFeedback(t("assetTransfers.status.savingAdd"));
    setError(null);
}
