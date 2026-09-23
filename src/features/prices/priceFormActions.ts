import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type { PriceWorkspaceDraft } from "./priceWorkspaceDraft";
import type {
  LedgerData,
  PriceSnapshot,
} from "@/core/models";
import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from "react";
import type {
  PriceFormField,
  PriceFormState,
} from "./priceFormHelpers";
import type { useLanguage } from "@/ui";
import {
  captureLedgerTime,
  resolveFactMoment,
} from "@/core/shared";
import { createValidatedPriceSnapshot } from "./priceSnapshotService";
import {
  formatValidationError,
  toPriceFormField,
} from "./priceFormHelpers";
import { createPriceWorkspaceDraft } from "./priceWorkspaceDraft";

type HandleSubmitDeps = {
  clock: LedgerClock;
  currency: "USDT";
  form: PriceWorkspaceDraft;
  ledgerData: LedgerData;
  mutationVersion: number | undefined;
  onPriceSnapshotCreated: (priceSnapshot: PriceSnapshot, timeSnapshot: LedgerTimeSnapshot) => ApplyLedgerActionResult;
  pendingMutationVersion: number | null;
  pendingResetRef: RefObject<Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined>;
  persistedVersion: number | undefined;
  persistenceStatus: PersistenceStatus | undefined;
  savingMessage: string;
  setErrors: Dispatch<SetStateAction<Partial<Record<PriceFormField, string>>>>;
  setLocalForm: Dispatch<SetStateAction<PriceFormState>>;
  setPendingMutationVersion: Dispatch<SetStateAction<number | null>>;
  setSuccessMessage: Dispatch<SetStateAction<string>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function doHandleSubmit(
  deps: HandleSubmitDeps,
  event: FormEvent<HTMLFormElement>,
) {
  const {
    clock,
    currency,
    form,
    ledgerData,
    mutationVersion,
    onPriceSnapshotCreated,
    pendingMutationVersion,
    pendingResetRef,
    persistedVersion,
    persistenceStatus,
    savingMessage,
    setErrors,
    setLocalForm,
    setPendingMutationVersion,
    setSuccessMessage,
    t,
  } = deps;
    event.preventDefault();
    if (pendingMutationVersion !== null) return;
    const timeSnapshot = captureLedgerTime(clock);

    const moment = resolveFactMoment(
      form.recordedAt,
      form.recordedTime,
      form.recordedTimeZone,
    );
    if (!moment.ok) {
      setErrors({
        recordedAt: t(
          moment.reason === "nonexistent"
            ? "prices.validation.nonexistentWallTime"
            : moment.reason === "ambiguous"
              ? "prices.validation.ambiguousWallTime"
              : "prices.validation.invalidTimeZone",
        ),
      });
      setSuccessMessage("");
      return;
    }

    const result = createValidatedPriceSnapshot(
      {
        assetSymbol: form.assetSymbol,
        price: form.price,
        currency,
        recordedAt: moment.value.occurredAt,
        ...(moment.value.occurredTimeZone === undefined
          ? {}
          : { occurredTimeZone: moment.value.occurredTimeZone }),
        source: "manual",
        ...(form.note.trim() === "" ? {} : { note: form.note.trim() }),
      },
      ledgerData,
      {
        generateId: () => globalThis.crypto.randomUUID(),
        now: () => timeSnapshot.now.toISOString(),
        todayKey: () => timeSnapshot.todayKey,
      },
    );

    if (!result.ok) {
      if (result.kind === "service") {
        setErrors({ form: t("prices.status.serviceError") });
        return;
      }

      const nextErrors: Partial<Record<PriceFormField, string>> = {};
      for (const error of result.errors) {
        const field = toPriceFormField(error.field);
        nextErrors[field] ??= formatValidationError(error, t);
      }
      setErrors(nextErrors);
      setSuccessMessage("");
      return;
    }

    const mutationResult = onPriceSnapshotCreated(
      result.priceSnapshot,
      timeSnapshot,
    );

    if (mutationResult !== "applied") {
      setErrors({
        form:
          mutationResult === "rejected"
            ? t("prices.status.ledgerNotWritable")
            : t("prices.status.unchanged"),
      });
      setSuccessMessage("");
      return;
    }

    if (
      mutationVersion === undefined ||
      persistedVersion === undefined ||
      persistenceStatus === undefined
    ) {
      setLocalForm({
        ...createPriceWorkspaceDraft(
          form.assetSymbol,
          captureLedgerTime(clock).todayKey,
          clock,
        ),
        recordedAt: form.recordedAt,
      });
      setErrors({});
      setSuccessMessage(t("prices.status.added"));
      return;
    }

    pendingResetRef.current = {
      assetSymbol: form.assetSymbol,
      recordedAt: form.recordedAt,
    };
    setErrors({});
    setPendingMutationVersion(mutationVersion + 1);
    setSuccessMessage(savingMessage);
}
