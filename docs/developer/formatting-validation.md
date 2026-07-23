# Formatter Corpus Validation

Use the formatter corpus runner to measure the real-world impact of formatting changes before adding or accepting a new formatter policy.

## Run

```bash
npm run validate:formatting-corpus
```

The command reads `.dla` and `.dlp` files recursively from `.ops/diagnostics-lab/corpus`. It never rewrites those files. To use another corpus or artifact location:

```bash
npm run validate:formatting-corpus -- --corpus /path/to/corpus --runs-dir /path/to/runs
```

Each run writes a git-excluded directory under `.ops/diagnostics-lab/runs/formatting/` containing:

- `summary.json`: aggregate churn, parse-mode, idempotence, execution-failure, and largest-diff results.
- `changes.jsonl`: one result per source file.
- `formatted/`: only the formatted copies of files that changed, preserving corpus-relative paths for direct diffing against the source corpus.

## Review

Review the largest diffs first, comparing each formatted copy with its unchanged corpus source. Treat parsed and recovery-mode results separately: recovery-mode formatting is intentionally conservative because the source may be incomplete or malformed.

A run fails only when the runner cannot process a file or a second formatter pass produces further edits. Ordinary formatting churn is evidence to review, not a command failure. Select a subsequent formatter policy change only from a concrete, repeatable corpus finding; do not alter the corpus to make a run pass.
