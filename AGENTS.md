# Main Product Branch Rules

## Branch role

- This worktree must remain on `main` and serves the long-term personal ledger product.
- The separate `CS2026` worktree serves the graduation thesis.
- Verify the current worktree path and `git branch --show-current` before any mutation.
- Never merge, rebase, cherry-pick, copy fixes, or edit both long-lived branches automatically.
- Record potentially reusable findings in the outer weekly log. Change the other branch only after an explicit user decision.

## Language

- The product UI and internal source material may remain Chinese.
- Write `README.md`, module documentation, release notes, and new Git commit subjects in English.
- Keep historical commit messages unchanged. Do not rewrite Git history for translation.
- The outer planning and log repository remains Chinese-first and follows its own rules.

## Repository boundary

- Treat this directory as an independent source-code Git repository.
- Do not combine its status, branches, diffs, staging, commits, or pushes with the outer documentation repository or the `CS2026` worktree.
- Preserve existing user changes and do not commit or push unless explicitly requested.
