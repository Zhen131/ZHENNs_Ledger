import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MESSAGE_TABLE = /^ui\/i18nMessages\.[^/]+\.ts$/u;
const ENTRY_FILE_NAMES = new Set(["index.ts", "ui.ts"]);
const MINIMUM_HEADER_SENTENCES = 3;
const TODO_MARKER = /\b(?:TODO|FIXME|XXX)\b/u;
const MEMO_REFERENCE = /备忘录 [ABCD]0-\d+/u;
const ESLINT_DISABLE = "eslint-disable";
const ESLINT_REASON = " -- ";
const TYPED_TAG = /@(?:param|returns|type) \{/u;

const NOT_YET_DOCUMENTED: readonly string[] = [
  "app/dashboard/CompatibilityWarningList.tsx",
  "app/dashboard/DashboardShell.tsx",
  "app/dashboard/DashboardShellHelpers.ts",
  "app/dashboard/DashboardShellHomePage.tsx",
  "app/dashboard/DashboardShellSettingsPage.tsx",
  "app/dashboard/FutureCorrectionPanel.tsx",
  "app/dashboard/LedgerWorkspaceFrame.tsx",
  "app/dashboard/LockConfirmationPanel.tsx",
  "app/dashboard/PersistenceErrorNotice.tsx",
  "app/dashboard/RepositorySwitchBlockedNotice.tsx",
  "app/dashboard/SessionFatalPanel.tsx",
  "app/dashboard/SessionQuiescingPanel.tsx",
  "app/dashboard/dashboardDerivations.ts",
  "app/dashboard/dashboardShellActions.ts",
  "app/file-access/ledgerFileAccessController.ts",
  "app/file-access/ledgerFileAccessControllerHelpers.ts",
  "app/file-access/ledgerFileAccessControllerTypes.ts",
  "app/gate/AccessCheckingPanel.tsx",
  "app/gate/AccessPanel.tsx",
  "app/gate/FormError.tsx",
  "app/gate/LedgerAccessGate.tsx",
  "app/gate/LedgerAccessGateHelpers.ts",
  "app/gate/LedgerAccessGateTypes.ts",
  "app/gate/LegacyRetiredPanel.tsx",
  "app/gate/PasswordField.tsx",
  "app/gate/SessionLockingPanel.tsx",
  "app/gate/ledgerAccessComposition.ts",
  "app/gate/ledgerAccessGateActions.ts",
  "app/gate/ledgerAccessGateSession.ts",
  "app/layout.tsx",
  "app/page.tsx",
  "app/persistence/hydrationState.ts",
  "app/persistence/usePersistentLedger.ts",
  "app/persistence/usePersistentLedgerActions.ts",
  "app/persistence/usePersistentLedgerBrowserEffects.ts",
  "app/persistence/usePersistentLedgerHelpers.ts",
  "app/persistence/usePersistentLedgerImport.ts",
  "app/persistence/usePersistentLedgerLifecycle.ts",
  "app/persistence/usePersistentLedgerPersistence.ts",
  "app/persistence/usePersistentLedgerSession.ts",
  "app/persistence/usePersistentLedgerTypes.ts",
  "app/workspaces/FilterSelect.tsx",
  "app/workspaces/HomeWorkspace.tsx",
  "app/workspaces/RecordWorkspace.tsx",
  "app/workspaces/RecordWorkspaceFactCard.tsx",
  "app/workspaces/RecordWorkspacePriceSection.tsx",
  "app/workspaces/RecordWorkspaceTargetCard.tsx",
  "app/workspaces/SettingsWorkspace.tsx",
  "app/workspaces/SettingsWorkspaceDangerPanel.tsx",
  "app/workspaces/SettingsWorkspaceTabBar.tsx",
  "app/workspaces/TransactionsWorkspace.tsx",
  "app/workspaces/TransactionsWorkspaceActivityCard.tsx",
  "app/workspaces/TransactionsWorkspaceFilterCard.tsx",
  "app/workspaces/TransferWorkspace.tsx",
  "app/workspaces/recordWorkspaceActions.ts",
  "app/workspaces/settingsWorkspaceActions.ts",
  "app/workspaces/transactionsWorkspaceDeletion.ts",
  "app/workspaces/transactionsWorkspaceHelpers.ts",
  "app/workspaces/transactionsWorkspaceIntent.ts",
  "app/workspaces/transactionsWorkspaceTypes.ts",
  "app/workspaces/useLedgerWorkspaceSession.ts",
  "app/workspaces/workspaceDrafts.ts",
  "core/calculations/cashReplay.ts",
  "core/calculations/positionCalculator.ts",
  "core/calculations/positionReplay.ts",
  "core/calculations/tradeCashImpact.ts",
  "core/catalog/builtInAssets.ts",
  "core/models/types.ts",
  "core/policies/ledgerFactPolicy.ts",
  "core/policies/ledgerImportPolicy.ts",
  "core/state/initialLedgerData.ts",
  "core/state/ledgerReducer.ts",
  "core/validation/isoDateValidator.ts",
  "core/validation/ledgerDataValidator.ts",
  "core/validation/ledgerDataValidatorAsset.ts",
  "core/validation/ledgerDataValidatorAssetTransfer.ts",
  "core/validation/ledgerDataValidatorCashEvent.ts",
  "core/validation/ledgerDataValidatorFeeRule.ts",
  "core/validation/ledgerDataValidatorIntegrity.ts",
  "core/validation/ledgerDataValidatorPrice.ts",
  "core/validation/ledgerDataValidatorReaders.ts",
  "core/validation/ledgerDataValidatorSchema.ts",
  "core/validation/ledgerDataValidatorTrade.ts",
  "core/validation/priceSnapshotValidator.ts",
  "core/validation/priceSnapshotValidatorErrors.ts",
  "core/validation/priceSnapshotValidatorReaders.ts",
  "core/validation/resourcePolicy.ts",
  "core/validation/technicalId.ts",
  "core/validation/tradeValidator.ts",
  "core/validation/tradeValidatorConsistency.ts",
  "core/validation/tradeValidatorErrors.ts",
  "core/validation/tradeValidatorReaders.ts",
  "features/activity/ActivityTable.tsx",
  "features/activity/ActivityTableParts.tsx",
  "features/activity/ActivityTableRow.tsx",
  "features/activity/activityPagination.ts",
  "features/activity/activityService.ts",
  "features/activity/activityTableEffects.ts",
  "features/activity/activityTableLabels.tsx",
  "features/activity/activityTimeFormat.ts",
  "features/asset-transfers/AssetTransferFields.tsx",
  "features/asset-transfers/AssetTransferPanel.tsx",
  "features/asset-transfers/AssetTransferPanelEventList.tsx",
  "features/asset-transfers/AssetTransferPanelForm.tsx",
  "features/asset-transfers/assetTransferPanelActions.ts",
  "features/asset-transfers/assetTransferPanelHelpers.ts",
  "features/asset-transfers/assetTransferService.ts",
  "features/asset-transfers/assetTransferServiceContract.ts",
  "features/assets/LocalAssetManager.tsx",
  "features/assets/assetService.ts",
  "features/backup/BackupControls.tsx",
  "features/backup/BackupControlsActionRow.tsx",
  "features/backup/BackupControlsPairingPanel.tsx",
  "features/backup/PreflightReportView.tsx",
  "features/backup/backupControlsActions.ts",
  "features/backup/backupControlsHelpers.ts",
  "features/backup/backupControlsPairing.ts",
  "features/backup/backupControlsTypes.ts",
  "features/backup/backupDownload.ts",
  "features/backup/backupDuplicateGrouping.ts",
  "features/backup/backupEnvelope.ts",
  "features/backup/backupImportPreflight.ts",
  "features/backup/backupImportPreflightCollectors.ts",
  "features/backup/backupImportPreflightReceipts.ts",
  "features/backup/backupImportPreflightResult.ts",
  "features/backup/backupImportPreflightTypes.ts",
  "features/backup/backupImportReport.ts",
  "features/cash/CashEventPanel.tsx",
  "features/cash/CashEventPanelEventList.tsx",
  "features/cash/CashEventPanelForm.tsx",
  "features/cash/NegativeCashConfirmationDialog.tsx",
  "features/cash/cashEventPanelActions.ts",
  "features/cash/cashEventPanelHelpers.ts",
  "features/cash/cashEventService.ts",
  "features/cash/cashProjection.ts",
  "features/charts/EChart.tsx",
  "features/charts/HoldingAllocationChart.tsx",
  "features/charts/HoldingTrendChart.tsx",
  "features/charts/TradeHeatmapChart.tsx",
  "features/charts/chartDataService.ts",
  "features/charts/chartDataServiceAllocation.ts",
  "features/charts/chartDataServiceHeatmap.ts",
  "features/charts/chartDataServiceHistory.ts",
  "features/charts/chartDataServiceShared.ts",
  "features/charts/chartOptionBuilders.ts",
  "features/fees/FeeRuleManager.tsx",
  "features/fees/FeeRuleManagerForm.tsx",
  "features/fees/FeeRuleManagerRuleList.tsx",
  "features/fees/feeRuleManagerActions.ts",
  "features/fees/feeRuleManagerHelpers.ts",
  "features/fees/feeRuleService.ts",
  "features/market-data/MappingRow.tsx",
  "features/market-data/MarketDataControls.tsx",
  "features/market-data/MarketDataControlsHoldingsList.tsx",
  "features/market-data/MarketDataControlsRefreshBar.tsx",
  "features/market-data/binanceMappingService.ts",
  "features/market-data/binancePriceRefreshService.ts",
  "features/market-data/marketDataControlsAssetActions.ts",
  "features/market-data/marketDataControlsEffects.ts",
  "features/market-data/marketDataControlsGlobalRefresh.ts",
  "features/market-data/marketDataControlsHelpers.ts",
  "features/market-data/marketDataControlsTypes.ts",
  "features/portfolio/HoldingsDetails.tsx",
  "features/portfolio/HoldingsOverview.tsx",
  "features/portfolio/ledgerProjection.ts",
  "features/portfolio/pnlSummaryService.ts",
  "features/portfolio/positionService.ts",
  "features/portfolio/priceSelectionService.ts",
  "features/portfolio/valuationDisplay.ts",
  "features/prices/PriceForm.tsx",
  "features/prices/PriceFormFields.tsx",
  "features/prices/priceFormActions.ts",
  "features/prices/priceFormEffects.ts",
  "features/prices/priceFormHelpers.ts",
  "features/prices/priceSnapshotService.ts",
  "features/prices/priceWorkspaceDraft.ts",
  "features/trades/TradeDeleteControl.tsx",
  "features/trades/TradeForm.tsx",
  "features/trades/TradeFormFeeSourcePanel.tsx",
  "features/trades/TradeFormPreviewAndSubmit.tsx",
  "features/trades/TradeFormTotalValueField.tsx",
  "features/trades/tradeDeleteDelay.ts",
  "features/trades/tradeFormActions.ts",
  "features/trades/tradeFormEffects.ts",
  "features/trades/tradeFormHelpers.ts",
  "features/trades/tradeFormTypes.ts",
  "features/trades/tradeRemovalService.ts",
  "features/trades/tradeService.ts",
  "features/trades/tradeWorkspaceDraft.ts",
  "platform/coordination/ledgerFileSessionCoordinator.ts",
  "platform/encryption/cryptoEncoding.ts",
  "platform/encryption/ledgerKeyDerivation.ts",
  "platform/encryption/passphrasePolicy.ts",
  "platform/files/byteArraysEqual.ts",
  "platform/files/ledgerFileChunkedContainerV3.ts",
  "platform/files/ledgerFileChunkedContainerV3Aad.ts",
  "platform/files/ledgerFileChunkedContainerV3Constants.ts",
  "platform/files/ledgerFileChunkedContainerV3Header.ts",
  "platform/files/ledgerFileChunkedContainerV3Parse.ts",
  "platform/files/ledgerFileChunkedContainerV3Serialize.ts",
  "platform/files/ledgerFileChunkedContainerV3Shared.ts",
  "platform/files/ledgerFileChunkingV3.ts",
  "platform/files/ledgerFileChunkingV3Payload.ts",
  "platform/files/ledgerFileChunkingV3Plan.ts",
  "platform/files/ledgerFileChunkingV3Shared.ts",
  "platform/files/ledgerFileConnectionAdapter.ts",
  "platform/files/ledgerFileContainerV3.ts",
  "platform/files/ledgerFileContainerV3Aad.ts",
  "platform/files/ledgerFileContainerV3Constants.ts",
  "platform/files/ledgerFileContainerV3Header.ts",
  "platform/files/ledgerFileContainerV3Parse.ts",
  "platform/files/ledgerFileContainerV3Serialize.ts",
  "platform/files/ledgerFileContainerV3Shared.ts",
  "platform/files/ledgerFileContract.ts",
  "platform/files/ledgerFileContractConstants.ts",
  "platform/files/ledgerFileContractEncryption.ts",
  "platform/files/ledgerFileContractPayload.ts",
  "platform/files/ledgerFileContractShared.ts",
  "platform/files/ledgerFileContractValidate.ts",
  "platform/files/ledgerFileCrypto.ts",
  "platform/files/ledgerFileHandleAdapter.ts",
  "platform/files/ledgerFileHandleAdapterContract.ts",
  "platform/files/ledgerFileRepository.ts",
  "platform/files/ledgerFileRepositoryContract.ts",
  "platform/files/ledgerFileRepositoryIntents.ts",
  "platform/files/ledgerFileRepositoryPayload.ts",
  "platform/files/ledgerFileRepositorySupport.ts",
  "platform/files/ledgerFileRepositoryVerify.ts",
  "platform/files/ledgerFileRepositoryWrite.ts",
  "platform/files/ledgerFileSessionLease.ts",
  "platform/files/ledgerFileSlotContainerV3.ts",
  "platform/files/ledgerFileSlotContainerV3Aad.ts",
  "platform/files/ledgerFileSlotContainerV3Constants.ts",
  "platform/files/ledgerFileSlotContainerV3Header.ts",
  "platform/files/ledgerFileSlotContainerV3Parse.ts",
  "platform/files/ledgerFileSlotContainerV3Serialize.ts",
  "platform/files/ledgerFileSlotContainerV3Shared.ts",
  "platform/integrations/binanceMarketDataClient.ts",
  "platform/integrations/binanceMarketDataTypes.ts",
  "platform/legacy/indexedDbStorageAdapter.ts",
  "platform/legacy/ledgerAccessController.ts",
  "platform/persistence/identity.ts",
  "platform/persistence/ledgerContentIdentity.ts",
  "platform/persistence/ledgerRepository.ts",
  "platform/persistence/ledgerRepositoryBrands.ts",
  "platform/persistence/ledgerRepositoryContract.ts",
  "platform/persistence/ledgerRepositoryReadyAuthorization.ts",
  "platform/persistence/ledgerRepositoryReadyRuntime.ts",
  "platform/persistence/ledgerRepositorySessionRuntime.ts",
  "test-support/applyLedgerFileWritableDataForTest.ts",
  "test-support/deferred.ts",
  "test-support/fixtures.ts",
  "test-support/readLedgerFileForTest.ts",
  "test-support/readLedgerFileForTestCodec.ts",
  "test-support/repositoryBackedReadyDrivers.ts",
  "test-support/seedRetiredBrowserLedgerRecord.ts",
  "test-support/testLedgerCapabilities.ts",
  "test-support/validatingMemoryLedgerRepository.ts",
  "test-support/vitest.setup.ts",
  "ui/ConfirmDeleteButton.tsx",
  "ui/FileStatusIndicator.tsx",
  "ui/LedgerIcon.tsx",
  "ui/LedgerNumber.tsx",
  "ui/PaginationBar.tsx",
  "ui/SurfaceCard.tsx",
  "ui/feedbackTiming.ts",
  "ui/formatLedgerNumber.ts",
  "ui/i18n.tsx",
  "ui/translationGlossary.ts",
];

describe("comment coverage", () => {
  it("gives every documented source file a three-sentence header and documented exports", () => {
    const pending = new Set(NOT_YET_DOCUMENTED);
    const problems = sourceFiles(SRC_ROOT)
      .map(sourcePath)
      .filter((file) => isDocumentationScope(file) && !pending.has(file))
      .flatMap((file) =>
        documentationProblems(file).map((problem) => `${file}: ${problem}`),
      );

    expect(problems).toEqual([]);
  });

  it("ties every TODO to a memo entry and every eslint-disable to a reason", () => {
    const pending = new Set(NOT_YET_DOCUMENTED);
    const problems = sourceFiles(SRC_ROOT)
      .map(sourcePath)
      .filter((file) => !pending.has(file))
      .flatMap((file) =>
        markerProblems(file).map((problem) => `${file}: ${problem}`),
      );

    expect(problems).toEqual([]);
  });

  it("lists only existing in-scope files, sorted and without duplicates", () => {
    const problems = NOT_YET_DOCUMENTED.flatMap((file) => {
      if (!existsSync(join(SRC_ROOT, file))) {
        return [`${file}: listed but missing`];
      }
      return isDocumentationScope(file) ? [] : [`${file}: listed but out of scope`];
    });

    expect(problems).toEqual([]);
    expect(NOT_YET_DOCUMENTED).toEqual([...new Set(NOT_YET_DOCUMENTED)].sort());
  });

  it("drops a listed file once it is fully documented", () => {
    const documented = NOT_YET_DOCUMENTED.filter(
      (file) =>
        existsSync(join(SRC_ROOT, file)) &&
        documentationProblems(file).length === 0 &&
        markerProblems(file).length === 0,
    );

    expect(documented).toEqual([]);
  });
});

function isDocumentationScope(file: string): boolean {
  if (!/\.tsx?$/u.test(file) || file.includes("/__tests__/") || file.startsWith("__tests__/")) {
    return false;
  }
  if (MESSAGE_TABLE.test(file)) {
    return false;
  }
  return !(ENTRY_FILE_NAMES.has(basename(file)) && isReexportOnly(parse(file)));
}

function isReexportOnly(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.every(
    (statement) =>
      ts.isImportDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined),
  );
}

function documentationProblems(file: string): string[] {
  const sourceFile = parse(file);
  const text = sourceFile.text;
  const problems: string[] = [];
  const header = fileHeader(text);

  if (header === undefined) {
    problems.push("does not start with a /** file header");
  } else if (sentenceCount(blockContent(text.slice(header.pos, header.end))) < MINIMUM_HEADER_SENTENCES) {
    problems.push(`file header has fewer than ${MINIMUM_HEADER_SENTENCES} sentences`);
  }

  for (const statement of sourceFile.statements) {
    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier === undefined) {
        problems.push(`line ${line}: local export list; export the declaration itself`);
      }
      continue;
    }
    if (!isExportedStatement(statement)) {
      continue;
    }
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length > 1
    ) {
      problems.push(`line ${line}: one export statement declares several names`);
      continue;
    }
    const problem = exportDocumentationProblem(sourceFile, statement, header);
    if (problem !== undefined) {
      problems.push(`line ${line}: ${problem}`);
    }
  }

  return problems;
}

function isExportedStatement(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement)) {
    return true;
  }
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function exportDocumentationProblem(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  header: ts.CommentRange | undefined,
): string | undefined {
  const text = sourceFile.text;
  const comment = (ts.getLeadingCommentRanges(text, statement.pos) ?? []).at(-1);
  if (comment === undefined || !text.startsWith("/**", comment.pos)) {
    return "export has no /** description directly above it";
  }
  if (header !== undefined && comment.pos === header.pos) {
    return "the file header cannot double as the export description";
  }
  const gap = text.slice(comment.end, statement.getStart(sourceFile));
  if (gap.trim().length > 0 || (gap.match(/\n/gu) ?? []).length > 1) {
    return "export description is not directly above the export";
  }
  const content = blockContent(text.slice(comment.pos, comment.end));
  const firstLine = content.split("\n").find((line) => line.trim().length > 0);
  if (firstLine === undefined || firstLine.trim().startsWith("@")) {
    return "export description has no first sentence";
  }
  if (TYPED_TAG.test(content)) {
    return "export description repeats a type in a tag";
  }
  return undefined;
}

function fileHeader(text: string): ts.CommentRange | undefined {
  if (!text.startsWith("/**")) {
    return undefined;
  }
  const first = (ts.getLeadingCommentRanges(text, 0) ?? [])[0];
  return first !== undefined && first.pos === 0 ? first : undefined;
}

function blockContent(block: string): string {
  return block
    .replace(/^\/\*\*/u, "")
    .replace(/\*\/$/u, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?/u, ""))
    .join("\n");
}

function sentenceCount(content: string): number {
  const fullWidth = (content.match(/[。；]/gu) ?? []).length;
  const halfWidth = (content.match(/[.;](?=\s|$)/gu) ?? []).length;
  return fullWidth + halfWidth;
}

function markerProblems(file: string): string[] {
  const sourceFile = parse(file);
  const text = sourceFile.text;
  return commentRanges(sourceFile).flatMap((range) =>
    text
      .slice(range.pos, range.end)
      .split("\n")
      .flatMap((line, index) => {
        const where = `line ${sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1 + index}`;
        const problems: string[] = [];
        if (TODO_MARKER.test(line) && !MEMO_REFERENCE.test(line)) {
          problems.push(`${where}: TODO, FIXME or XXX without a memo reference`);
        }
        if (line.includes(ESLINT_DISABLE) && !line.includes(ESLINT_REASON)) {
          problems.push(`${where}: eslint-disable without a -- reason`);
        }
        return problems;
      }),
  );
}

function commentRanges(sourceFile: ts.SourceFile): ts.CommentRange[] {
  const text = sourceFile.text;
  const ranges = new Map<number, ts.CommentRange>();
  const jsxTexts: { pos: number; end: number }[] = [];

  function collect(found: ts.CommentRange[] | undefined): void {
    for (const range of found ?? []) {
      ranges.set(range.pos, range);
    }
  }

  function visit(node: ts.Node): void {
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    ) {
      return;
    }
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxTexts.push({ pos: node.pos, end: node.end });
    }
    collect(ts.getLeadingCommentRanges(text, node.pos));
    collect(ts.getTrailingCommentRanges(text, node.end));
  }

  visit(sourceFile);
  collect(ts.getLeadingCommentRanges(text, sourceFile.endOfFileToken.pos));

  return [...ranges.values()]
    .filter(
      (range) =>
        !jsxTexts.some(({ pos, end }) => range.pos >= pos && range.pos < end),
    )
    .sort((left, right) => left.pos - right.pos);
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readSource(file),
    ts.ScriptTarget.Latest,
    true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function readSource(file: string): string {
  return readFileSync(join(SRC_ROOT, file), "utf8");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function sourcePath(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join("/");
}
