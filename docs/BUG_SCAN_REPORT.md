# Bug Scan Report (Critical Findings)

Date: 2026-02-23
Scope: Entire repository static review + available local checks

## Scan coverage
- Reviewed backend API routes and services for input validation, path safety, regex safety, and backup integrity.
- Attempted dependency/tooling install to run automated checks, but registry access returned HTTP 403 in this environment.

---

## Critical Bug 1 — Backup file collision can corrupt restores

- **Severity:** Critical
- **Area:** Backup/restore data integrity
- **Files:** `backend/src/services/backup.ts`

### Why this is critical
The backup process stores files by **basename only** (`path.basename(componentPath)`), not full relative path. If two different component files share the same filename (e.g., `components/ui/button.tsx` and `components/forms/button.tsx`), one backup copy overwrites the other in the backup directory. On restore, both original paths can receive the same (last-written) content.

This causes silent data corruption and breaks trust in the safety/rollback mechanism.

### Repro (conceptual)
1. Backup two files with different directories but same basename.
2. Observe backup folder contains only one `button.tsx` file.
3. Restore backup.
4. Observe both original paths restored from the same backup blob.

### Root cause
`createBackup()` computes destination as `path.join(backupPath, path.basename(componentPath))`, causing collisions.

---

## Critical Bug 2 — Unvalidated regex in templates can crash template apply workflow

- **Severity:** Critical
- **Area:** Template application availability (DoS by malformed user template)
- **Files:** `backend/src/routes/templates.ts`, `backend/src/services/modifier.ts`, `backend/src/utils/validation.ts`

### Why this is critical
Template creation/update only validates type shape of rules, not regex validity/safety for `isRegex: true`. During template apply, each rule is passed to `applyChanges()`, which constructs `new RegExp(find, 'g')` before per-file error handling.

A malformed pattern (e.g., `"("`) throws at runtime and aborts the operation. A user can persist such a template and repeatedly trigger failures, causing sustained service disruption for template apply operations.

### Repro (conceptual)
1. Create template rule with `isRegex: true` and invalid regex, e.g. `find: "("`.
2. Call `POST /api/templates/:id/apply`.
3. Service returns failure due to regex construction exception.

### Root cause
Regex safety checks exist (`validateRegex`) but are not enforced in template create/update paths.

---

## Critical Bug 3 — Batch `remove-class` builds unsafe regex from user input

- **Severity:** Critical
- **Area:** Runtime stability / regex injection risk
- **Files:** `backend/src/services/modifier.ts`, `backend/src/routes/edit.ts`

### Why this is critical
Batch action `remove-class` interpolates user-provided class name directly into a regex pattern (`\\s*${className}`) with no escaping and no safety validation. This can produce malformed regex (runtime exceptions) or expensive patterns.

Because this is exposed through a backend route, a crafted request can repeatedly trigger server errors and potentially expensive regex processing.

### Repro (conceptual)
1. Call `POST /api/edit/batch-action` with `action: "remove-class"` and `options.className: "("`.
2. Regex compilation fails in modify pipeline.
3. Route returns error; repeated calls can degrade service reliability.

### Root cause
No `validateRegex` call and no `escapeRegExp` for user class token before converting to regex.

---

## Environment limitation encountered
- Could not run dependency-driven automated checks (`bun install`) due to repeated HTTP 403 responses from npm registry mirrors in this environment.

## Recommended remediation order
1. Fix backup collision logic first (data integrity/safe rollback guarantee).
2. Enforce regex validation on template create/update when `isRegex` is true.
3. Escape + validate user-derived regex in `remove-class` batch action.
