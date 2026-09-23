import type {
  PriceFormField,
  PriceFormState,
} from "./priceFormHelpers";
import type { PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type { LedgerData } from "@/core/models";
import type { LedgerClock } from "@/core/shared";
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { createPriceWorkspaceDraft } from "./priceWorkspaceDraft";
import { captureLedgerTime } from "@/core/shared";
import type { PersistenceStatus } from "@/app";
import type { useLanguage } from "@/ui";

type PriceAssetRepairEffectDeps = {
  commitForm: (next: PriceFormState) => void;
  form: PriceWorkspaceDraft;
  ledgerData: LedgerData;
};

export function runPriceAssetRepairEffect(
  deps: PriceAssetRepairEffectDeps,
) {
  const {
    commitForm,
    form,
    ledgerData,
  } = deps;
    if (
      ledgerData.assets.some(
        (asset) => asset.symbol === form.assetSymbol,
      )
    ) {
      return;
    }
    commitForm({
      ...form,
      assetSymbol: ledgerData.assets[0]?.symbol ?? "",
    });
}

type PriceEpochResetEffectDeps = {
  clock: LedgerClock;
  draft: PriceWorkspaceDraft | undefined;
  ledgerData: LedgerData;
  pendingResetRef: RefObject<Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined>;
  setLocalForm: Dispatch<SetStateAction<PriceFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string>>;
};

export function runPriceEpochResetEffect(
  deps: PriceEpochResetEffectDeps,
) {
  const {
    clock,
    draft,
    ledgerData,
    pendingResetRef,
    setLocalForm,
    setPendingMutationVersion,
    setSuccessMessage,
  } = deps;
    setPendingMutationVersion(null);
    pendingResetRef.current = undefined;
    setSuccessMessage("");
    if (!draft) {
      setLocalForm(
        createPriceWorkspaceDraft(
          ledgerData.assets[0]?.symbol ?? "",
          captureLedgerTime(clock).todayKey,
          clock,
        ),
      );
    }
}

type PendingPriceSaveEffectDeps = {
  certifiedSavedMessage: string;
  clock: LedgerClock;
  draft: PriceWorkspaceDraft | undefined;
  onReset: ((preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">) => void) | undefined;
  pendingMutationVersion: number | null;
  pendingResetRef: RefObject<Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined>;
  persistedVersion: number | undefined;
  persistenceStatus: PersistenceStatus | undefined;
  setErrors: Dispatch<SetStateAction<Partial<Record<PriceFormField, string>>>>;
  setLocalForm: Dispatch<SetStateAction<PriceFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runPendingPriceSaveEffect(
  deps: PendingPriceSaveEffectDeps,
) {
  const {
    certifiedSavedMessage,
    clock,
    draft,
    onReset,
    pendingMutationVersion,
    pendingResetRef,
    persistedVersion,
    persistenceStatus,
    setErrors,
    setLocalForm,
    setPendingMutationVersion,
    setSuccessMessage,
    t,
  } = deps;
    if (
      pendingMutationVersion === null ||
      persistedVersion === undefined ||
      persistenceStatus === undefined
    ) {
      return;
    }
    if (
      persistedVersion >= pendingMutationVersion &&
      persistenceStatus === "saved"
    ) {
      const preserve = pendingResetRef.current;
      setPendingMutationVersion(null);
      pendingResetRef.current = undefined;
      if (preserve) {
        if (draft && onReset) {
          onReset(preserve);
        } else {
          setLocalForm({
            ...createPriceWorkspaceDraft(
              preserve.assetSymbol,
              captureLedgerTime(clock).todayKey,
              clock,
            ),
            recordedAt: preserve.recordedAt,
          });
        }
      }
      setErrors({});
      setSuccessMessage(certifiedSavedMessage);
      return;
    }
    if (persistenceStatus === "error") {
      setSuccessMessage("");
      setErrors((current) => ({
        ...current,
        form: t("prices.status.unsaved"),
      }));
    }
}
