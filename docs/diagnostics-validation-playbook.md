# Diagnostics Validation Playbook

This document defines a repeatable process for validating large `.dla` corpora (400+ files) and improving Emergent language diagnostics quickly.

## Goals
- Validate parser/resolver/type-checker diagnostics at scale.
- Reduce false positives without introducing regressions.
- Keep triage/data-entry fast enough for frequent iterations.

## Scope
- Extension integration tests: `npm test`
- Server/unit diagnostics behavior: `npm run test:server`
- Lint/type safety: `npm run lint`, `npm run typecheck`
- Corpus-level diagnostics run (headless script; recommended to add if missing)

## Local-Only Workspace Layout
Use the local, git-excluded workspace:

`/.ops/diagnostics-lab/`

Recommended structure:
- `/.ops/diagnostics-lab/corpus/`
- `/.ops/diagnostics-lab/runs/`
- `/.ops/diagnostics-lab/baseline/`
- `/.ops/diagnostics-lab/tags/`
- `/.ops/diagnostics-lab/tmp/`

`corpus/` is the nominated subdirectory for `.dla` expressions used during training-style iteration.

## Workflow Summary
1. Run diagnostics across corpus.
2. Triage a small batch (recommended: 20 items).
3. Implement highest-leverage fixes.
4. Re-run checks and corpus diagnostics.
5. Diff against baseline and repeat.

## Manual Work Required
Automation handles collection, sorting, and reporting. Human input is still required for:
- Labeling diagnostics as `tp`, `fp`, `missing`, or `unclear`.
- Adding short notes where intent is not obvious.
- Sanity-checking behavior in VS Code on representative files after fixes.
- Deciding when baseline changes are intentional and should be accepted.

## Iteration Cadence
- Recommended batch size per cycle: `20` diagnostics.
- Reason: enough pattern signal, low review overhead.
- Typical cycle:
  - Tag 20 findings.
  - Apply clustered fixes.
  - Run test gates.
  - Re-run corpus validation.

## Fast Triage Design
To keep tagging fast, use:

1. Stable diagnostic IDs
- ID formula: hash of `file + line + code + normalized_message`.
- Allows reliable diffing and re-triage across runs.

2. Flat JSONL tags file
- Suggested path: `artifacts/diagnostic-tags.jsonl`
- One tag per line:
```json
{"id":"abc123","label":"fp","note":"keyword parsed as identifier"}
```

3. Small fixed label set
- `tp` = true positive
- `fp` = false positive
- `missing` = expected diagnostic not emitted
- `unclear` = needs further analysis

4. One-key review loop (recommended tooling)
- `f` -> `fp`
- `t` -> `tp`
- `m` -> `missing`
- `u` -> `unclear`
- `s` -> skip

## Implemented Commands
- `npm run validate:corpus`
  - Scans `/.ops/diagnostics-lab/corpus/` recursively for `.dla`.
  - Writes run artifacts to `/.ops/diagnostics-lab/runs/<timestamp>/`.
  - Produces:
    - `diagnostics.jsonl`
    - `summary.json`
    - `added-vs-baseline.jsonl`
    - `removed-vs-baseline.jsonl`

- `npm run validate:corpus:baseline`
  - Same as `validate:corpus`, then updates:
  - `/.ops/diagnostics-lab/baseline/current.jsonl`

- `npm run triage:diagnostics`
  - Interactive tagging (default limit 20).
  - Reads latest run diagnostics.
  - Appends tags to:
  - `/.ops/diagnostics-lab/tags/diagnostic-tags.jsonl`

- `npm run triage:report`
  - Summarizes tag coverage and top untagged messages for the latest run.

Optional overrides for custom paths:
- `node scripts/validate-dla-corpus.js --corpus <dir> --runs-dir <dir> --baseline <file>`
- `node scripts/triage-diagnostics.js --run-file <diagnostics.jsonl> --tags <tags.jsonl> --limit 20`

## Baseline and Regression Control
Maintain a baseline diagnostics snapshot (JSONL) and compare every new run:
- New diagnostics (potential regressions)
- Removed diagnostics (potential fixes)
- Changed message/range (potential behavior drift)

Only update baseline intentionally after review.

## Prioritization Strategy
When selecting fixes:
1. Crashes/throws and broken parsing.
2. High-frequency false positives.
3. Missing diagnostics with high user impact.
4. Low-frequency edge cases.

## Quality Gates Per Iteration
Run these after each fix batch:
1. `npm run lint`
2. `npm run test:server`
3. `npm test` (integration tests)
4. Corpus diagnostics run + baseline diff

## Recommended Project Tasks
Scripts are now present:
- `validate:corpus`
- `validate:corpus:baseline`
- `triage:diagnostics`
- `triage:report`

## Session Collaboration Pattern
Per iteration with Codex:
1. Provide corpus run output (or top-N grouped findings).
2. Provide ~20 tagged items.
3. Codex clusters root causes, summarizes observations and assumptions, and asks targeted clarification questions where intent is ambiguous.
4. After clarification, Codex patches minimal, test-backed fixes.
5. Re-run gates and summarize net diagnostic changes.

## Practical Iteration Checklist
1. Add or update `.dla` files under `/.ops/diagnostics-lab/corpus/`.
2. Run `npm run validate:corpus`.
3. Run `npm run triage:diagnostics` and tag about 20 diagnostics.
4. Optionally run `npm run triage:report` to inspect coverage and top untagged messages.
5. Ask Codex to analyze latest tags, then confirm/clarify any ambiguous intent before implementation.
6. Review results in editor on sample files.
7. If behavior is correct, update baseline with `npm run validate:corpus:baseline`.

## Prompt Templates
Use one of these prompts directly with Codex after tagging.

Analysis-only (no code changes):
```text
Please analyze the latest diagnostics tags from .ops/diagnostics-lab and do not make any code changes yet.

Tasks:
1) Read latest run diagnostics and tags.
2) Cluster tagged items by likely root cause.
3) For each cluster, estimate impact (% of current corpus diagnostics affected).
4) Provide a prioritized fix plan.
5) Ask me targeted clarification questions for any ambiguous intent before implementation.

Important: analysis only, no edits in this step.
```

Analyze + implement fixes:
```text
Please use the latest diagnostics run and tags under .ops/diagnostics-lab to implement the next iteration.

Tasks:
1) Analyze tagged diagnostics and cluster root causes.
2) Summarize your observations and assumptions.
3) Ask clarification questions where intent is ambiguous; otherwise proceed with minimal fixes.
4) Implement highest-leverage fixes first.
5) Run quality gates: npm run lint, npm run test:server, npm test (if environment supports it), and npm run validate:corpus.
6) Summarize net change: diagnostics total, added/removed vs baseline, and remaining top untagged messages.
```

Strict clarification-first mode:
```text
Please analyze latest tags and prepare a fix proposal, but do not edit code until I answer your clarification questions.
```

## Notes on Environment
- `npm test` may need `.vscode-test` cache available locally; otherwise it may try to download VS Code binaries.
- In restricted environments, run offline gates first (`lint`, `typecheck`, `test:server`), then run integration tests where cache/network is available.
