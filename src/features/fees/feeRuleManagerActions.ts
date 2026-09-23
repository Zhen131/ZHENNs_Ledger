import type { PersistenceStatus } from "@/app";
import type {
  Dispatch,
  SetStateAction,
} from "react";
import type { useLanguage } from "@/ui";

type FeeRulePersistenceEffectDeps = {
  certifiedSavedMessage: string;
  pendingVersion: number | null;
  persistedVersion: number;
  persistenceStatus: PersistenceStatus;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPendingVersion: Dispatch<SetStateAction<number | null>>;
  t: ReturnType<typeof useLanguage>["t"];
};

export function runFeeRulePersistenceEffect(
  deps: FeeRulePersistenceEffectDeps,
) {
  const {
    certifiedSavedMessage,
    pendingVersion,
    persistedVersion,
    persistenceStatus,
    setError,
    setMessage,
    setPendingVersion,
    t,
  } = deps;
    if (pendingVersion === null) return;
    if (
      persistedVersion >= pendingVersion &&
      persistenceStatus === "saved"
    ) {
      setPendingVersion(null);
      setMessage(certifiedSavedMessage);
      return;
    }
    if (persistenceStatus === "error") {
      setPendingVersion(null);
      setMessage("");
      setError(t("fees.status.unsaved"));
    }
}
