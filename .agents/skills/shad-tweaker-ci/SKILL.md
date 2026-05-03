---
name: shad-tweaker-ci
description: Repo-local workflow for shad-tweaker PRs, ticket-driven fixes, CI failure repair, Biome formatting/lint failures, backend test/build failures, registry-source PRs, and Git handoff. Use when Codex is asked to change this repository, inspect or fix a PR, address CI/CD failures, finish ticket work, commit changes, or push a branch in C:\Users\carso\Documents\shad-tweaker.
---

# Shad Tweaker CI

## Workflow

Use this skill only for the `shad-tweaker` repo.

1. Start with context:
   - Run `git status --short --branch`.
   - Read the user request, PR notes, CI logs, and referenced ticket details before editing.
   - Treat untracked or unrelated files as user-owned unless the task explicitly includes them.

2. Keep commits small:
   - Prefer multiple focused commits over one large commit when the work has separable pieces.
   - Good split examples: implementation, tests, docs, CI/script fixes.
   - Before each commit, stage only the files for that logical unit and review `git diff --cached --name-only`.
   - Do not bundle pre-existing untracked files, local artifacts, or unrelated line-ending churn.

3. Avoid recurring CI failures:
   - For Biome failures, run `npm run check` first; use `npm run check:fix` only when broad formatting writes are acceptable, then confirm `git diff --name-only` did not pick up unrelated files.
   - Keep imports organized exactly as Biome expects.
   - Prefer optional chaining when Biome flags `useOptionalChain`.
   - Keep formatting to the repository defaults; do not hand-wrap against Biome.
   - On Windows, expect shell glob quirks. Use the repo script `npm run backend:test`; it should run `cd backend && node --import tsx --test test/*.ts`.

4. Required verification before final handoff or push:
   - `npm run check`
   - `npm run backend:test`
   - `npm run backend:build`
   - Add any narrower test command that directly exercises the changed behavior.

5. Registry-source PR checklist:
   - Centralize shared URL and identifier validation in `backend/src/utils/validation.ts`.
   - Validate registry source IDs and item names with an allowlist, not path-traversal denylists.
   - Mock `globalThis.fetch` in tests; do not depend on real network behavior.
   - Restore mocked globals in `afterEach`.
   - Cover route and service behavior for listing, fallback lookup, missing/dead sources, unsafe identifiers, and mapping payload fields.
   - Keep docs in `docs/REGISTRY-SOURCES.md` synchronized with added endpoints.

6. Commit and push discipline:
   - Run the required verification before the final commit when feasible.
   - Commit message should describe the behavior changed, not the mechanical fix.
   - Push only after the intended commits exist and `git status --short --branch` has no unexpected staged changes.
