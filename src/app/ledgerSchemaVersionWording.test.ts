import { describe, expect, it } from "vitest";

import { validateLedgerImportPolicy } from "@/core/policies";
import { createInitialLedgerData } from "@/core/state";
import { SUPPORTED_LEDGER_SCHEMA_VERSION } from "@/platform/files";
import { translateDefault } from "@/ui";

import { LEDGER_FILE_ACCESS_ERROR_CODES } from "./ledgerFileAccessController";
import { getFileAccessErrorMessage } from "./LedgerAccessGateHelpers";

/**
 * Interface wording that names the ledger schema version went stale once
 * already: the ledger moved to 5 and several sentences kept saying 4, with no
 * test to notice. Every such sentence is pinned here against the version's own
 * definition, so the next bump either carries the wording with it or turns one
 * of these red.
 */
const CURRENT = `V${SUPPORTED_LEDGER_SCHEMA_VERSION}`;
const t = translateDefault;

describe("interface wording that names the ledger schema version", () => {
  it("names the current version when a file carries an unsupported schema", () => {
    const message = getFileAccessErrorMessage(
      LEDGER_FILE_ACCESS_ERROR_CODES.UNSUPPORTED_LEDGER_SCHEMA,
      t,
    );

    expect(message).toBe(
      `该文件承载 V3、其他旧版或未知 schema 的账本；当前 ${CURRENT} 不兼容且不提供迁移。已在密码、KDF 和解密前停止；原文件未被写入、删除或覆盖。你仍可新建 ${CURRENT} 账本。`,
    );
  });

  it("names the current version when an import uses an unsupported valuation currency", () => {
    const ledgerData = createInitialLedgerData();
    ledgerData.assets = [
      { ...ledgerData.assets[0], quoteCurrency: "EUR" as never },
    ];

    const result = validateLedgerImportPolicy(ledgerData, "2026-12-01");

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((error) => error.message)).toContain(
      `${CURRENT} 只支持 USDT 估值`,
    );
  });
});
