import type { RefObject } from "react";

import type { LedgerData } from "@/core/models";
import type { PostImportPairingOperation } from "./backupControlsTypes";

// Shape of BackupControls' `pairingLatestRef` (inferred there from its useRef initial value).
type PairingLatest = {
  ledgerData: LedgerData;
  ledgerEpoch: number;
  sessionGeneration: number;
  mutationVersion: number;
  persistedVersion: number;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  isWritable: boolean;
};

type PairingOperationIsCurrentDeps = {
  mountedRef: RefObject<boolean>;
  pairingLatestRef: RefObject<PairingLatest>;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
};

export function doPairingOperationIsCurrent(
  deps: PairingOperationIsCurrentDeps,
  operation: PostImportPairingOperation,
): boolean {
  const {
    mountedRef,
    pairingLatestRef,
    pairingOperationRef,
  } = deps;
    const latest = pairingLatestRef.current;
    return (
      mountedRef.current &&
      pairingOperationRef.current === operation &&
      latest.isWritable &&
      latest.ledgerEpoch === operation.ledgerEpoch &&
      latest.sessionGeneration === operation.sessionGeneration
    );
}
