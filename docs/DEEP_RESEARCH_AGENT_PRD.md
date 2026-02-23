# Deep Research Agent + Product Requirements Document (PRD)

## 0) Context
This document defines a **Deep Research Agent** for `shadcn-tweaker` and a complete PRD for evolving the project into a reliable system for batch-customizing shadcn-based components across diverse repositories.

The target outcome is a robust workflow that can:
- Discover shadcn component trees accurately
- Understand common shadcn patterns and composition
- Apply safe, auditable bulk transformations
- Prevent path traversal and data-loss incidents

---

## 1) Deep Research Agent Specification

### 1.1 Agent name
**Shadcn Deep Research Agent (SDRA)**

### 1.2 Mission
Build and maintain a high-confidence model of:
1. shadcn component conventions and structure
2. project-local file tree layout and import relationships
3. safe transformation opportunities for batch customization

### 1.3 Inputs
- Repository root path
- Optional explicit components path(s)
- Existing scan cache (if present)
- User-selected goals (e.g. radius updates, class cleanup, focus-ring normalization)

### 1.4 Core outputs
- `component_graph.json` (component files, exports, dependencies, className usage)
- `customization_candidates.json` (candidate edits with confidence and rationale)
- `safety_report.json` (path safety, regex safety, backup risk checks)
- Human-readable summary with proposed actions and risk levels

### 1.5 Operating model
1. **Discover**
   - Locate likely component roots (`src/components/ui`, `components/ui`, monorepo paths, and configured overrides).
   - Validate all paths are inside the approved project root.
2. **Parse**
   - Index TS/TSX/JS/JSX files.
   - Extract exports, import graph edges, className/class usage patterns.
3. **Classify**
   - Identify likely shadcn primitives, wrappers, and app-level compositions.
   - Tag files by confidence score (high/medium/low) using naming + structure heuristics.
4. **Plan edits**
   - Generate deterministic transformation plans (rule ID, files, expected match counts).
   - Reject unsafe regex and ambiguous rules.
5. **Simulate and score risk**
   - Produce previews/diffs, estimate blast radius, detect collisions/conflicts.
6. **Execute (gated)**
   - Require successful backup + explicit confirmation before writes.
   - Log every modified path and rule application result.

### 1.6 Guardrails
- Strict path normalization and containment checks
- Regex safety policy (disallow dangerous constructs)
- Collision-proof backup layout (preserve relative paths, never basename-only)
- Idempotent operations where possible
- Hard caps on files touched per action (configurable)

### 1.7 Success criteria for the agent
- Finds component roots with >95% precision on supported repo layouts
- Zero path traversal violations
- Zero backup overwrite collisions
- Full per-file audit trail for every batch operation

---

## 2) shadcn Structural Knowledge Model (for this project)

### 2.1 What the agent must understand
- shadcn components are often file-based primitives in `components/ui`-style folders.
- Most customizations involve utility classes in `className` expressions.
- Components are frequently wrapped/re-exported from feature or app layers.
- Modern repos may include monorepo/workspace layouts and path aliases.

### 2.2 Required repository understanding dimensions
1. **Tree topology**: root, package boundaries, app/frontend/backend folders
2. **Component locality**: exact directories containing editable UI components
3. **Import connectivity**: where primitives are consumed downstream
4. **Class mutation points**: literals, template strings, utility helpers (e.g. class concatenation)
5. **Safety boundaries**: files that should never be touched (generated/vendor/build outputs)

### 2.3 Component confidence scoring (example)
- +40: file under known shadcn directory
- +20: React component export pattern
- +20: className utility usage patterns
- +10: known shadcn naming conventions
- +10: co-located variant/size patterns

Confidence bands:
- 80–100: High-confidence shadcn component
- 50–79: Likely related component
- <50: Non-target by default

---

## 3) Product Requirements Document (PRD)

## 3.1 Product vision
`shadcn-tweaker` becomes the safest and fastest way to apply consistent design-system changes to shadcn component fleets in real-world repositories.

## 3.2 Problem statement
Teams using shadcn components need broad style updates (radius, focus states, spacing, class cleanups), but manual edits are slow and error-prone. Existing bulk text replacement can break components if path discovery or regex handling is weak.

## 3.3 Users
- **Primary:** Frontend engineers maintaining shadcn-based repos
- **Secondary:** Design system maintainers enforcing style standards
- **Tertiary:** Tech leads requiring auditable, reversible mass edits

## 3.4 Goals
- G1: Accurate component discovery across varied repo layouts
- G2: Safe, preview-first bulk customization
- G3: Reliable backup/restore with data integrity guarantees
- G4: Policy-driven rule validation to prevent runtime failures

## 3.5 Non-goals (initial)
- Full AST codemod engine replacing all regex/text operations
- Automatic visual regression at launch
- Framework-specific transform plugins beyond React ecosystems

## 3.6 Functional requirements

### FR-1 Discovery and indexing
- Must scan configured/default component paths.
- Must support monorepo-adjacent directories.
- Must produce index metadata: file path, line count, class usage count, exports.

### FR-2 Safe edit planning
- Every action creates a deterministic plan before mutation.
- Plan includes affected files, expected replacements, and risk level.

### FR-3 Preview
- Diff previews available for each file before apply.
- Total change count shown per action.

### FR-4 Apply with rollback
- Backup created before first file mutation.
- Restore operation must recover exact original file bytes.

### FR-5 Validation and policy enforcement
- Validate all component paths against project root boundaries.
- Validate regex syntax and safety for all user-defined and template rules.
- Batch actions must escape/validate user-derived regex fragments.

### FR-6 Template lifecycle
- Create/list/get/update/delete templates.
- Enforce validation at creation/update time, not only apply time.

### FR-7 Auditability
- Structured logs for scan/apply/restore events.
- Result payloads include modified files, errors, backup IDs.

## 3.7 Non-functional requirements
- **Reliability:** No silent corruption; partial failures are explicit.
- **Performance:** O(n) over candidate files for scan/apply operations.
- **Security:** Path traversal defenses and conservative regex policy.
- **Operability:** Clear error codes/messages for all routes.

## 3.8 API-level implications
- Keep preview/apply/template/backup endpoints but harden contracts.
- Add explicit validation error fields for per-rule/per-file failures.
- Add optional dry-run route for batch/template apply.

## 3.9 CLI/TUI requirements
- Show discovered component roots and confidence.
- Highlight risky rules before execution.
- Require explicit confirmation for high-blast-radius actions.

## 3.10 Metrics
- Discovery precision/recall on benchmark repos
- % successful apply operations without manual intervention
- Mean time to rollback
- Number of blocked unsafe operations (path/regex)

## 3.11 Acceptance criteria (MVP hardening)
1. Backup system preserves unique mapping for files with duplicate basenames.
2. Template create/update rejects unsafe or invalid regex rules.
3. `remove-class` action handles arbitrary class text safely (escape + validation).
4. All blocked operations return stable machine-readable error codes.
5. A full preview/apply/restore flow passes on representative shadcn repo layouts.

## 3.12 Milestones
- **M1: Safety hardening**
  - Backup collision fix
  - Regex validation enforcement in templates
  - Safe regex construction in batch actions
- **M2: Discovery intelligence**
  - Confidence scoring and richer indexing
  - Better monorepo path detection heuristics
- **M3: UX and observability**
  - TUI risk labeling and summaries
  - Structured audit logs and quality metrics dashboard

---

## 4) Research notes and external reference handling

The requested shadcn LLM reference (`https://ui.shadcn.com/llms.txt`) could not be retrieved in this execution environment due to HTTP 403 network restrictions. This PRD is therefore based on repository inspection plus established shadcn usage patterns. Once access is available, SDRA should ingest that reference as a first-class knowledge source and reconcile any differences.

---

## 5) Recommended next implementation artifacts
1. `docs/ARCHITECTURE.md` section for SDRA pipeline and data contracts
2. JSON schemas for `component_graph`, `customization_candidates`, and `safety_report`
3. End-to-end fixture repos for discovery/apply/restore validation
4. Regression test cases for duplicate-basename backups and regex safety
