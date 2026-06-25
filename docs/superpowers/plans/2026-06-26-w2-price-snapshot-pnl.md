# Week 2 Price Snapshot and Unrealized PnL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the pure position calculator so trades and price snapshots produce latest price, market value, and unrealized PnL.

**Architecture:** `PriceSnapshot` remains a saved market-price fact independent from `Trade`. `calculatePositions` accepts `Trade[]` plus optional `PriceSnapshot[]`, derives the existing position fields from trades, then enriches each position with the latest same-asset, same-currency snapshot. Positions remain derived data and are never persisted.

**Tech Stack:** TypeScript, decimal.js through `decimalMath`, Vitest.

---

### Task 1: Lock the public behavior with failing tests

**Files:**
- Modify: `src/test/fixtures.ts`
- Modify: `src/calculators/positionCalculator.test.ts`

- [ ] Add a `createPriceSnapshot` fixture helper that produces complete `PriceSnapshot` objects.
- [ ] Add a no-snapshot test asserting `latestPrice`, `marketValue`, and `unrealizedPnl` are `undefined`.
- [ ] Add a single-snapshot test asserting `marketValue = quantity × latestPrice` and `unrealizedPnl = marketValue − costBasis`.
- [ ] Add a multi-snapshot test asserting the largest `recordedAt` wins.
- [ ] Add an equal-`recordedAt` test asserting the later array entry wins.
- [ ] Add tests proving snapshots are isolated by asset and currency.
- [ ] Add an assertion proving price enrichment does not change `realizedPnl`.
- [ ] Run `npm test -- src/calculators/positionCalculator.test.ts` and verify the new behavior fails because `calculatePositions` does not yet accept or process snapshots.

### Task 2: Implement the minimal calculator extension

**Files:**
- Modify: `src/calculators/positionCalculator.ts`

- [ ] Change the public API to `calculatePositions(trades: Trade[], priceSnapshots: PriceSnapshot[] = []): Position[]`.
- [ ] Keep the existing trade sorting and buy/sell accumulation unchanged.
- [ ] For each position, filter snapshots by matching `assetSymbol` and `currency`.
- [ ] Select the snapshot with the greatest lexicographically comparable ISO `recordedAt`; replace the selected snapshot when timestamps are equal so the later array entry wins.
- [ ] If no compatible snapshot exists, return the existing position without the three optional price-derived fields.
- [ ] If a snapshot exists, set `latestPrice`, compute `marketValue` with `multiply`, and compute `unrealizedPnl` with `subtract`.
- [ ] Run `npm test -- src/calculators/positionCalculator.test.ts` and verify the calculator tests pass.
- [ ] Run `npm test` and verify no existing DecimalMath or Validator behavior regresses.

### Task 3: Complete Week 2 source verification and documentation

**Files:**
- Modify: `README.md`

- [ ] Update the Week 2 completed list to include latest snapshot selection, market value, and unrealized PnL.
- [ ] Remove those items from the “not implemented” and “next step” sections.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check`.
- [ ] Inspect `git status --short` and the complete branch diff.

### Task 4: Update the external Week 2 progress records without touching unrelated changes

**Files:**
- Modify: `01一些进度/日志/00-当前开发状态.md`
- Modify: `01一些进度/日志/week2_260619/00_W2-Checklist.md`
- Modify: `01一些进度/日志/week2_260619/99_Week2日志_260619.md`

- [ ] Mark the verified Week 2 calculator, validator, Vitest, and price-derived calculation work complete.
- [ ] Record the latest-snapshot tie rule and currency boundary.
- [ ] Move the active milestone to Week 3 Day 1 only after source verification succeeds.
- [ ] Preserve the existing unrelated Canvas modification and do not stage or edit it.
- [ ] Re-run source `npm test`, `npm run lint`, and `npm run build` after documentation edits to retain fresh completion evidence.
