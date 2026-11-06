/**
 * 这个文件管几个独一无二的标记。
 * 盖在授权和凭证上，证明它们是这一层亲手发的。
 * 它不管授权怎么发，那在 ledgerRepository.ts 和 ledgerRepositoryReadyAuthorization.ts。
 * 不显然的决定：用 Symbol 当标记，外面伪造不出来。这是猜的，日志里没写，要核。
 */

/** 「清空当前账本」授权上的标记。 */
export const readyLedgerClearAuthorizationBrand = Symbol(
  "ready-ledger-clear-authorization",
);
/** 「清空当前账本」执行凭证上的标记。 */
export const readyLedgerClearExecutionContextBrand = Symbol(
  "ready-ledger-clear-execution-context",
);
/** 「导入替换当前账本」授权上的标记。 */
export const readyLedgerImportAuthorizationBrand = Symbol(
  "ready-ledger-import-authorization",
);
/** 「导入替换当前账本」执行凭证上的标记。 */
export const readyLedgerImportExecutionContextBrand = Symbol(
  "ready-ledger-import-execution-context",
);
/** 「停止接新活」请求上的标记。 */
export const sessionQuiesceRequestBrand = Symbol(
  "ledger-session-quiesce-request",
);
/** 「活都做完了」凭证上的标记。 */
export const sessionQuiesceTokenBrand = Symbol(
  "ledger-session-quiesce-token",
);
