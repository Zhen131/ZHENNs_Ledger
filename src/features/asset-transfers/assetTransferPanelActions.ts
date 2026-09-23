import type { PersistenceStatus } from "@/app";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { AssetTransferServiceError } from "./assetTransferService";
import type { useLanguage } from "@/ui";

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
