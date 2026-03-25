# Emergent Expression Formatting Roadmap

This document defines a staged roadmap for improving formatting support for Emergent expression files only:
- `.dla`
- `.dlp`

The goal is to move from the current whitespace-only formatter to a syntax-aware formatter that materially improves day-to-day editing without forcing a disruptive rewrite of existing files in early stages.

The recommended sequence is:
1. establish strong formatter tests around current behavior
2. move formatting onto the server with output intentionally close to the current client-side formatter
3. build richer formatting capability on top of shared parser/token/AST infrastructure

## Execution Status

### Current Block Status
- Block 1: Foundation and safety rails: in progress
- Block 2: Server-side formatter parity: completed
- Block 3: Syntax-aware formatting core: in progress
- Block 4: Block layout and multiline normalization: not started
- Block 5: Selection formatting and range correctness: not started
- Block 6: Polish, hardening, and adoption: not started

### Last Completed Step
- Block 3 slice: refined parse-recovery-safe formatting from whole-line preservation to diagnostic-character-range preservation. In recovery mode, syntax-covered lines now format around protected diagnostic spans instead of being skipped wholesale.
- Scope decision: the recovery boundary is now character-range based, derived from syntax diagnostic locations; it still does not attach comments/trivia or rebuild spacing from token ownership.
- Assumption: whitespace immediately adjacent to a protected diagnostic span should be preserved rather than normalized across that boundary, so malformed regions keep their local context while surrounding safe text can still clean up.
- Lesson captured for future PRs: current `coveredBySyntax` metadata is sufficient to unlock smaller recovery-safe edits when combined with diagnostic character ranges, but true token/trivia ownership is still needed before structural formatting rules land safely.
- Lesson captured for future PRs: parser/runtime shape and static AST typing do not align perfectly for every statement expression path (notably `if`-shaped expressions), so formatter work should validate runtime node shapes instead of assuming the current types are exhaustive.
- Lesson captured for future PRs: comment preservation is still achieved by conservative line handling rather than true comment/trivia attachment, so structural formatting PRs should define comment ownership rules before introducing broader layout changes.
- Validation lesson captured for future PRs: `npm test` exercises the bundled extension artifacts (`client/dist/extension.js` and `server/dist/server.js`), so formatter changes may require rebuilding the relevant bundle before integration results reflect current source edits.

### Next Recommended PR
- Block 3: replace diagnostic-character-range preservation with token- or trivia-aware safe regions so malformed statements can preserve only the truly ambiguous tokens instead of nearby separator whitespace.
- Keep broad structural layout rules deferred until recovery-region precision and comment/trivia attachment strategy are explicit.

### Roadmap Update Rule
- Each roadmap PR should update this section.
- Mark completed work precisely and name the next recommended PR-sized slice.
- If implementation choices narrow or expand scope, record that decision here before finalizing the PR.

## Current State
- Formatting is implemented server-side in [server/src/formatting.ts](/mnt/c/Users/pchandle/Documents/git/vscode-ec-language-extension/server/src/formatting.ts).
- Current behavior is intentionally small in scope:
  - collapse repeated spaces in many non-comment contexts
  - normalize comma spacing
  - normalize `->` spacing
  - trim trailing whitespace
- Full-line `//` comments are skipped.
- Formatting is not parse-aware and does not use expression structure to decide indentation, line wrapping, or block layout.
- `Format Document`, `Format Selection`, and VS Code `formatOnSave` therefore provide only light cleanup rather than layout normalization.

## Goals
- Improve editing productivity for `.dla` and `.dlp` files.
- Keep early stages minimally disruptive so developers can adopt formatting without large noisy diffs.
- Base later formatting decisions on language structure rather than regex-only transforms.
- Keep formatting behavior deterministic and testable.
- Make contribution boundaries clear so multiple PRs can advance formatting without drifting in style or architecture.

## Non-Goals
- Formatting `.cspec`, `.pspec`, `.pdes`, or `.pdd` files.
- Reworking general language-server navigation and refactoring features in this roadmap.
- Introducing broad style customization before the formatter has a stable default policy.
- Hand-editing generated assets as part of formatting work.

## Formatting Principles
- Prefer predictable output over clever heuristics.
- Prefer stable, repeatable transforms over context-sensitive guesses.
- Preserve user intent in early stages where layout is ambiguous.
- Avoid formatting changes that alter language semantics.
- Avoid style churn: once a rule is introduced, it should remain stable unless there is a clear correctness or usability issue.
- Treat comments as first-class syntax to preserve positioning and readability.

## Architectural Direction

### Near-Term Direction
- Use the current client-side formatter only as a temporary baseline and compatibility reference.
- Prioritize moving formatting behavior to the server early, even if the first server-side implementation is intentionally minimal.
- Continue exposing formatting through VS Code document/range formatting providers so `Format Document`, `Format Selection`, and `formatOnSave` keep working.
- Keep the client as thin transport and registration code once the server-side path exists.

### Target Direction
- Move formatting logic to a server-side syntax-aware implementation backed by the parser used by the language tooling.
- Prefer sharing parser/token infrastructure with the server so diagnostics and formatting operate on the same structural understanding.
- Separate formatting into explicit layers:
  - parse and recover
  - compute formatting decisions
  - emit edits
- Keep formatting policy isolated from VS Code transport code so behavior can be unit-tested without an editor host.

### Recommended Migration Strategy
- Do not invest heavily in expanding the client-side formatter.
- First, migrate formatting to the server with behavior intentionally close to the current formatter:
  - repeated-space cleanup in safe contexts
  - comma spacing normalization
  - `->` spacing normalization
  - trailing whitespace trimming
  - conservative comment preservation
- Treat that first server-side formatter as an architecture migration, not as a style-policy expansion.
- After parity is stable and tested, expand syntax-aware behavior in small slices using shared AST/token work.
- Do not port the current regex formatter mechanically if parser/token data can already express the same decisions more safely.

### Contribution Guardrails
- Do not add new regex rules if the same behavior should be driven by syntax and the parser already has the needed information.
- Do not mix style-policy changes with unrelated diagnostics or completion changes in the same PR.
- Every formatting rule change should be backed by tests that show both intended output and non-regression cases.
- Prefer additive staging: establish observability and fixtures first, then expand behavior.

## Roadmap Overview

The roadmap is divided into pragmatic work blocks. Each block should be shippable on its own and should improve formatting without requiring completion of the entire roadmap.

1. Foundation and safety rails
2. Server-side formatter parity
3. Syntax-aware formatting core
4. Block layout and multiline normalization
5. Selection formatting and range correctness
6. Polish, hardening, and adoption

## Block 1: Foundation and Safety Rails

### Objective
Create the test and fixture infrastructure needed to evolve formatting safely.

### Why First
- The current formatter is small enough that informal changes are tempting.
- Without fixture-based coverage, formatting work will drift and regress quickly.

### Scope
- Inventory current formatting behavior and document it explicitly.
- Expand unit and integration coverage for formatter behavior on `.dla` / `.dlp` samples.
- Add representative fixtures for:
  - basic `sub` / `job` / `host` / `join` lines
  - inline comments and full-line comments
  - blank lines
  - trailing spaces
  - malformed but commonly seen input
  - files that should remain unchanged
- Decide on a stable assertion style for formatter tests:
  - input text
  - formatted output
  - idempotence check
  - optional range-format expectation

### Deliverables
- A formatter test matrix that covers current behavior and known edge cases.
- Clear fixture organization for future stages.
- Idempotence tests: formatting formatted code should produce no further changes.

### Suggested Implementation Notes
- Keep tests close to the formatter implementation if they are narrow unit tests.
- Add broader integration tests where VS Code formatting commands are part of the behavior under test.
- Use normalized line endings in assertions.

### Acceptance Criteria
- Current formatting behavior is fully described by tests rather than only by code inspection.
- New formatting work can add fixtures without rewriting the harness.
- Formatter idempotence is enforced by tests.

## Block 2: Server-Side Formatter Parity

### Objective
Move formatting onto the language server while keeping output intentionally close to the current client-side formatter.

### Why This Stage Exists
- This is the earliest point where formatter work can start paying into shared syntax infrastructure.
- It avoids building out a second formatting architecture in the client that would later be discarded.
- It keeps risk manageable because behavior is intentionally narrow and familiar.

### Scope
- Add server-side formatting support for document and range formatting.
- Route client formatting requests through the server while preserving the existing VS Code UX entry points.
- Match current output closely for the initial server-side implementation:
  - repeated-space cleanup in safe contexts
  - comma spacing normalization
  - `->` spacing normalization
  - trailing whitespace trimming
  - conservative handling of full-line comments
- Reuse token or parser infrastructure where practical, but keep the initial policy intentionally small.
- Add parity fixtures that capture:
  - exact-match parity with current behavior
  - intentional deltas where the server-side implementation is safer
  - malformed-input preservation cases

### Explicit Deferrals
- no automatic block reindentation
- no multiline wrapping policy
- no major line splitting or joining
- no canonical reflow of ambiguous malformed code
- no broad style expansion beyond current formatter expectations

### Deliverables
- A server-side formatter that is stable enough to replace the client-side implementation for current use cases.
- A thin client formatting layer that delegates behavior instead of owning style logic.
- A regression suite proving parity or intentional, documented differences from the previous formatter.

### Acceptance Criteria
- `Format Document`, `Format Selection`, and `formatOnSave` are served by the server-side formatter path.
- Typical output remains close enough to current behavior that migration risk is low.
- Parser/token improvements made for formatting are positioned for reuse by diagnostics and later formatter stages.
- The client-side formatter no longer accumulates new policy logic.

## Block 3: Syntax-Aware Formatting Core

### Objective
Expand the server-side formatter into a proper formatting engine based on parsed Emergent expression structure.

### Why This Is the Pivotal Stage
This is the point where formatting stops being a transport migration and becomes a true language capability built on shared AST work.

### Scope
- Define the formatter input model:
  - token stream only, or
  - AST plus token/comment attachment data
- Tighten parser and recovery behavior needed by both diagnostics and formatting.
- Choose how the formatter behaves on parse errors:
  - format only structurally safe regions
  - preserve unparseable spans
  - continue formatting surrounding valid syntax
- Implement a formatting pipeline with clear phases:
  - parse
  - attach comments/trivia
  - build layout decisions
  - emit minimal edits
- Establish canonical formatting decisions for common expression constructs.

### Core Policy Questions To Resolve in Code
- How are statement keywords aligned?
- How are blocks indented after `-> {` or similar constructs?
- When is a construct kept on one line versus expanded across multiple lines?
- How are comments attached to adjacent syntax?
- What happens when input is partially invalid?

### Deliverables
- A syntax-aware server-side formatting module with focused tests independent of VS Code API plumbing.
- Documented behavior for parse-success and parse-recovery paths.

### Acceptance Criteria
- Formatter decisions come from syntax, not ad hoc regex stacking.
- Formatter and diagnostics benefit from the same parser and recovery improvements.
- The formatter preserves semantics on representative corpora.
- Invalid files do not suffer destructive rewrites.

## Block 4: Block Layout and Multiline Normalization

### Objective
Introduce the first major structural formatting improvements once the syntax-aware core is stable.

### Scope
- Canonical indentation for nested blocks.
- Consistent handling of multiline expressions.
- Normalize spacing and line breaks around:
  - block open/close tokens
  - multiline argument lists
  - nested `sub` / `job` / `host` / `join` structures where applicable
  - `end` alignment and surrounding blank lines
- Define blank-line policy for readability:
  - preserve existing blank lines unless excessive
  - normalize only in obvious cases first

### Rollout Strategy
- Introduce structural rules in narrowly scoped slices.
- Add fixtures for “before vs after” on realistic files, not just single-line examples.
- Avoid bundling many unrelated style decisions into one PR.

### Deliverables
- The formatter can make files materially easier to read, not just cleaner at the whitespace level.
- The extension begins to approach the expectations users have for mature languages.

### Acceptance Criteria
- Nested and multiline constructs have a stable, documented layout.
- Formatting output is deterministic across equivalent inputs.
- Review noise remains controlled because rule introduction is staged.

## Block 5: Selection Formatting and Range Correctness

### Objective
Ensure partial formatting is reliable and behaves predictably inside editors.

### Scope
- Verify `Format Selection` behavior for partial-line and multi-line ranges.
- Prevent range formatting from breaking surrounding syntax context.
- Define whether range formatting:
  - expands to enclosing syntactic unit, or
  - stays line-bounded with reduced guarantees
- Align selection formatting behavior with document formatting wherever practical.

### Why This Matters
- Developers use selection formatting when testing a formatter incrementally.
- Broken range behavior reduces confidence in adopting full `formatOnSave`.

### Deliverables
- A clear contract for range formatting behavior.
- Tests covering partial selections, block selections, and malformed selections.

### Acceptance Criteria
- Range formatting never produces syntactically worse surrounding text.
- The behavior is documented and consistent with implementation limits.

## Block 6: Polish, Hardening, and Adoption

### Objective
Make the formatter dependable enough to recommend as a default workflow.

### Scope
- Run formatter tests against a larger representative `.dla` / `.dlp` corpus.
- Measure noisy-diff cases and refine policies that cause disproportionate churn.
- Improve performance for format-on-save responsiveness on typical files.
- Add documentation for users once formatting behavior becomes materially more powerful.
- Revisit whether the formatter should become more opinionated after low-disruption adoption is proven.

### Deliverables
- Corpus-backed confidence in formatter stability.
- Contributor guidance for future formatter rule additions.
- Updated user documentation describing actual formatting behavior.

### Acceptance Criteria
- Formatting is fast enough for routine `formatOnSave`.
- Rule changes are evaluated against representative files, not only synthetic fixtures.
- User-facing docs match implemented behavior.

## Cross-Cutting Decisions

These decisions should be made once and then applied consistently across blocks.

### 1. Parse Error Policy
Recommended early policy:
- format only syntax regions that can be handled safely
- preserve unparseable regions as much as possible
- never guess at structural rewrites when the parse is uncertain

### 2. Comment Preservation
Recommended policy:
- preserve full-line comment indentation unless formatting the enclosing block makes the correct indentation unambiguous
- do not rewrite comment text content
- preserve inline comment attachment to the preceding syntax where possible

### 3. Idempotence
Required policy:
- formatting a document twice should yield no changes after the first pass

### 4. Minimal Edit Emission
Recommended policy:
- emit the narrowest edits that express the formatter decision
- avoid replacing entire documents when line- or region-level edits are sufficient

### 5. Style Configuration
Recommended early policy:
- do not add user-facing style knobs during foundational stages
- establish one stable default style first

## Suggested Test Strategy

### Unit Coverage
- token/AST formatting decisions
- comment attachment behavior
- parse-recovery behavior
- idempotence

### Integration Coverage
- `vscode.executeFormatDocumentProvider`
- `vscode.executeFormatRangeProvider`
- representative `.dla` / `.dlp` samples opened in the extension host

### Regression Fixtures
- malformed-but-common input
- files already considered “clean”
- files with comments around block boundaries
- mixed single-line and multiline constructs

### Validation Gates Per Formatter Iteration
1. `npm run lint`
2. `npm run typecheck`
3. Narrow formatter tests
4. `npm run test:server` if parser/shared syntax logic changes
5. `npm test` when integration behavior changes and environment supports it

## Proposed Contribution Pattern

For each formatter PR:
1. State which roadmap block the change belongs to.
2. State whether the change is low-disruption or structural.
3. Add or update fixtures first.
4. Implement the smallest coherent rule set.
5. Verify idempotence and non-regression.
6. Document any intentional style-policy decisions made by the PR.

PRs should avoid:
- mixing formatter architecture changes with unrelated extension work
- introducing broad canonical rewrites before the syntax-aware core is ready
- adding new style rules without representative fixtures

## Recommended Initial Backlog

This backlog is intentionally concrete enough to guide the first several contributions.

### Foundation
- Add formatter fixture coverage for current spacing behavior.
- Add explicit tests for comments, blank lines, malformed input, and no-op files.
- Add idempotence assertions.

### Server-Side Parity
- Add formatter fixture coverage that locks in current client-side behavior.
- Add server-side document/range formatting support with near-parity output.
- Migrate the client to thin transport only.
- Define and test any intentional parity deviations, especially around comments and malformed input.

### Syntax-Aware Core
- Design the formatter module boundary and data model.
- Reuse parser outputs or expose syntax data needed by formatting.
- Tighten parser/trivia recovery needed by both diagnostics and formatting.
- Implement safe formatting for a narrow subset of constructs first.

### Structural Layout
- Add indentation for unambiguous block forms.
- Add multiline layout rules for common expression patterns.
- Expand realistic file fixtures before broadening rules.

### Hardening
- Run formatting against representative local corpora.
- Record churn patterns and tune overly aggressive rules.
- Update user docs once formatting meaningfully exceeds whitespace cleanup.

## Definition of Done for the Roadmap
- `formatOnSave` for `.dla` / `.dlp` files provides reliable structural formatting rather than only whitespace cleanup.
- Early-stage adoption did not require disruptive repo-wide rewrites.
- Formatting behavior is deterministic, tested, and documented.
- Contributors have a clear staged path for extending formatting without style drift.

## Open Questions for Future Revisions
- Should malformed-input formatting eventually become more opinionated after the parser recovery path is stronger?
- At what point is the formatter stable enough to encourage repo-wide reformatting of sample or test files?

## Maintainer Notes
- Keep this roadmap updated when a block is substantially completed or intentionally deferred.
- If implementation reality diverges from this plan, update the roadmap in the same PR that changes direction.
- Prefer documenting final style policy here and user-facing behavior in `docs/user/user-guide.md`.
