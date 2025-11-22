#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <directory> <filename-pattern>" >&2
  echo "Example: $0 docs/fetched-specs \"*.json\"" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

SEARCH_DIR="$1"
FILENAME_PATTERN="$2"
SCHEMA_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/spec.schema.json"
LOG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/logs/schema-validation"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$LOG_ROOT/$TIMESTAMP"

if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "Schema not found at $SCHEMA_PATH" >&2
  exit 1
fi

if [[ ! -d "$SEARCH_DIR" ]]; then
  echo "Directory not found: $SEARCH_DIR" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

mapfile -d '' FILES < <(find "$SEARCH_DIR" -type f -name "$FILENAME_PATTERN" -print0)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No files matched pattern '$FILENAME_PATTERN' under '$SEARCH_DIR'." >&2
  exit 1
fi

node - <<'NODE' "$SCHEMA_PATH" "$RUN_DIR" "${FILES[@]}"
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const [, , schemaPath, runDir, ...files] = process.argv;
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

let success = 0;
const failures = [];

for (const file of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    failures.push({
      file,
      stage: 'parse',
      message: err.message
    });
    continue;
  }

  const valid = validate(data);
  if (valid) {
    success += 1;
  } else {
    failures.push({
      file,
      stage: 'validation',
      message: 'Schema validation failed',
      errors: validate.errors
    });
  }
}

const summary = {
  runDir,
  total: files.length,
  success,
  failures: failures.length
};

const failureLog = failures
  .map(f => {
    const header = `[${f.stage.toUpperCase()}] ${f.file}`;
    if (!f.errors) return `${header}\n  ${f.message}`;
    const details = f.errors
      .map(e => `  - path: ${e.instancePath || '/'}; schema: ${e.schemaPath}; message: ${e.message}`)
      .join('\n');
    return `${header}\n  ${f.message}\n${details}`;
  })
  .join('\n\n');

if (failureLog) {
  fs.writeFileSync(path.join(runDir, 'failures.log'), failureLog + '\n');
}
fs.writeFileSync(
  path.join(runDir, 'failures.jsonl'),
  failures.map(f => JSON.stringify(f)).join('\n') + (failures.length ? '\n' : '')
);
fs.writeFileSync(
  path.join(runDir, 'summary.json'),
  JSON.stringify(summary, null, 2)
);

console.log(`Validated ${summary.total} file(s).`);
console.log(`Success: ${summary.success}`);
console.log(`Failures: ${summary.failures}`);
console.log(`Logs: ${runDir}`);
NODE
