# CS2026 Thesis Branch Rules

## Branch role

- This worktree must remain on `CS2026` and serves the 2026 graduation thesis.
- The separate `main` worktree serves the long-term personal ledger product.
- Verify the current worktree path and `git branch --show-current` before any mutation.
- Never merge, rebase, cherry-pick, copy fixes, or edit both long-lived branches automatically.
- Record potentially reusable findings in the outer weekly log. Change the other branch only after an explicit user decision.

## Language

- Keep every tracked file in the working tree free of directly written Chinese characters.
- Write UI copy, source comments, tests, fixtures, documentation, release notes, and new Git commit subjects in English.
- Preserve runtime compatibility with Unicode and Chinese user data through escaped compatibility fixtures where needed.
- Keep historical commit messages unchanged. Do not rewrite Git history for translation.
- The outer planning and log repository remains Chinese-first and follows its own rules.

## Thesis evidence boundary

- Separate implemented behavior, development checks, independent acceptance, planned work, and supervisor decisions.
- Never turn `02D` or `03B` into `PASS` without the required independent evidence.
- Do not claim benchmark, CI, release, licensing, or evaluation work before it exists and is verified.
- Preserve `LedgerData`, backup, and `.lftl` compatibility unless the user explicitly approves a schema change.

## Repository boundary

- Treat this directory as an independent source-code worktree on `CS2026`.
- Do not combine its status, diff, staging, commits, or pushes with the outer documentation repository or the `main` worktree.
- Preserve existing user changes and do not commit or push unless explicitly requested.
