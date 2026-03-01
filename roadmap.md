# Emergent Coding Extension Roadmap

## Goal
Raise this extension to a first-class standard across reliability, UX, maintainability, and release discipline.

## Current State Summary
- Core language server functionality is strong and actively evolving.
- Runtime spec-fetch/cache and diagnostics workflows are now significantly improved.
- Main gaps are around engineering maturity: CI/CD automation, architectural boundaries, dead code removal, API/typing hygiene, and docs depth.

## Prioritization Model
- P0: Must-have for first-class baseline.
- P1: High-impact quality upgrades after baseline.
- P2: Strategic improvements.

---

## P0: First-Class Baseline (Next 1-2 Releases)

### 1) Establish CI/CD and Release Gates
Problem:
- No repository CI workflow directory (`.github/workflows` missing).
- Quality checks rely on manual local execution.

Actions:
- Add GitHub Actions workflows:
  - `ci.yml`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:server`, `npm run test:compile-client`.
  - Optional integration job for `npm test` with conditional execution (nightly or label-triggered) due to VS Code download constraints.
- Add branch protection requirement for CI pass on PR.
- Add a release workflow:
  - Build + package VSIX artifact.
  - Publish gated by tag and required checks.

Exit Criteria:
- Every PR has automated pass/fail quality signal.
- Tagged release can be produced reproducibly from CI only.

---

### 2) Remove Dead/Legacy Runtime Paths
Problem:
- `client/src/valley.ts` appears to be legacy/dead code and still carries TODOs/old fetch logic.
- Dead paths create confusion and maintenance risk.

Actions:
- Confirm no runtime/import references to `valley.ts` and delete dead file(s).
- Remove related stale comments/docs references to Valley indexing where Studio runtime fetch now applies.
- Add a short architecture note documenting the single authoritative fetch path (server-side gateway client).

Exit Criteria:
- Exactly one runtime fetch architecture path remains.
- No unused legacy fetch modules remain.

---

### 3) Harden Type Safety and Reduce `any` Footprint
Problem:
- High use of `as any` and `error: any` across server/client hot paths.
- Weak typing increases regression risk in language semantics.

Actions:
- Introduce typed interfaces for frequently cast structures:
  - AST statement narrowings used in hover/spec reference collection.
  - Protocol/contract spec payload helpers.
- Replace broad `any` with targeted union/type guards in:
  - `server/src/server.ts`
  - `server/src/specReferenceCollector.ts`
  - `server/src/lang/typeChecker.ts`
  - `client/src/extension.ts` (quick-fix and diagnostics parsing helpers)
- Add lint rules incrementally (warning -> error) for unsafe casts in touched files.

Exit Criteria:
- `any` usage in core server flow reduced substantially (tracked count reduction target: >=50% in `server/src/server.ts`).
- New code paths ship with explicit type guards.

---

### 4) Clarify and Correct User-Facing Hover/Navigation UX
Problem:
- Users still conflate VS Code link hovers (`Execute command`) with language hover output.
- Current behavior is correct but not self-explanatory.

Actions:
- Update README/docs with a concise “Navigation vs Hover” section:
  - Ctrl+Click behavior (DocumentLink command hint).
  - Type-hover suppression for classification/supplier tokens.
- Add a command quick reference table for:
  - Open spec panel
  - Open local spec
  - Bulk validation controls
- Consider an optional setting to disable classification DocumentLinks if teams find them intrusive.

Exit Criteria:
- Fewer recurring support questions around “why this hover appears”.
- Behavior and controls clearly documented in one place.

---

### 5) Strengthen Diagnostics/Hover Consistency Test Coverage
Problem:
- Recent regressions were discovered through manual usage rather than dedicated server tests.

Actions:
- Add targeted regression tests for:
  - Shared document spec context invalidation on content/config changes.
  - Hover consistency with diagnostics for nested job/sub/join scenarios.
  - Classification and supplier hover suppression contract.
- Add tests for spec-cache clear/reload invalidation behavior.

Exit Criteria:
- Regression scenarios seen in March 2026 are captured by automated tests.
- Server tests fail before user-visible hover/typing regressions ship.

---

## P1: Quality and Operability Upgrades

### 6) Improve Observability and Diagnostics Tooling
Problem:
- Trace logs exist but are difficult to correlate for field debugging.

Actions:
- Add structured trace markers around:
  - context hit/miss/build duration,
  - classification count,
  - cache hit/miss/failure cooldown reason,
  - hover completion source (context vs direct fetch path).
- Extend `Emergent: Show Configuration Diagnostics` report to include:
  - document-context status summary (counts, freshness),
  - current network/fallback behavior flags.

Exit Criteria:
- Common user issues can be triaged from logs/reports without code stepping.

---

### 7) Performance Budgets for Large Workspaces
Problem:
- Performance baseline tests exist but lack explicit budgets tied to acceptance.

Actions:
- Define performance SLOs for:
  - diagnostics latency per file,
  - hover response p95 on warm context,
  - completion response p95.
- Add perf assertion thresholds in CI for stable scenarios.
- Add micro-benchmarks for shared context build and reuse behavior.

Exit Criteria:
- Measurable and enforced performance targets for key language features.

---

### 8) Security and Supply-Chain Hygiene
Problem:
- Security docs exist, but automated checks are limited.

Actions:
- Add dependency audit workflow and periodic report (allowlist known advisories where justified).
- Add lockfile/update policy doc.
- Validate remote fetch hardening assumptions:
  - timeout coverage,
  - retry/backoff behavior,
  - failure cooldown semantics.

Exit Criteria:
- Security checks run continuously and are visible to maintainers.

---

## P2: Strategic Improvements

### 9) Modularize Server Orchestration Layer
Problem:
- `server/src/server.ts` is a large orchestration file carrying many concerns.

Actions:
- Split into focused modules:
  - spec-context service,
  - hover service,
  - completion service,
  - diagnostics orchestration,
  - request/command handlers.
- Keep `server.ts` as composition root only.

Exit Criteria:
- Reduced file complexity and easier ownership boundaries for contributors.

---

### 10) Documentation and Contributor Experience Upgrade
Problem:
- `docs/development.md` is very sparse for onboarding and architecture comprehension.

Actions:
- Expand development docs with:
  - architecture diagram and request/data flow,
  - local dev loop commands,
  - test matrix and when to run which suites,
  - debugging playbooks for hover/diagnostics/spec-fetch issues.
- Add “good first issue” and coding standards section.

Exit Criteria:
- A new contributor can make a safe server/client change in one session using docs only.

---

## Suggested Execution Order
1. CI/CD gates.
2. Dead-code removal + architecture note.
3. Shared-context regression tests and hover/diagnostics consistency hardening.
4. Type-safety reduction campaign.
5. UX/docs clarification for navigation vs hover.
6. Operability/performance/security upgrades.
7. Server modularization.

---

## Definition of "First-Class" for This Extension
The extension can be called first-class when:
- Quality is CI-enforced and release automation is reproducible.
- Hover/diagnostics/completion behavior is consistent and regression-tested.
- Runtime fetch/cache behavior is observable, predictable, and documented.
- User-facing controls and behaviors are clear and discoverable.
- Core server/client code is maintainable with strong typing and clear boundaries.
