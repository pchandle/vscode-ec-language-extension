#!/usr/bin/env node
/**
 * Normalize specification files against the strict schema.
 * Usage: normalize-specs.js [-apply] <directory> <filename-pattern>
 * Default is dry-run (log diffs only). With -apply, valid normalized specs overwrite the originals.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Ajv = require('ajv');

function usage(exitCode = 1) {
  console.error('Usage: normalize-specs.js [-apply] <directory> <filename-pattern>');
  process.exit(exitCode);
}

const args = process.argv.slice(2);
const apply = args[0] === '-apply';
const positional = apply ? args.slice(1) : args;
if (positional.length !== 2) usage(1);
const [rootDir, pattern] = positional;

const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'docs', 'spec.schema.json');
const logDir = path.join(repoRoot, 'logs', 'spec-normalisation');
function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const timestamp = formatTimestamp();
const logFile = path.join(logDir, `${timestamp}-normalize-specs.log`);

if (!fs.existsSync(schemaPath)) {
  console.error(`Schema not found at ${schemaPath}`);
  process.exit(1);
}
if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
  console.error(`Directory not found: ${rootDir}`);
  process.exit(1);
}
fs.mkdirSync(logDir, { recursive: true });

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function matchesPattern(name, globPattern) {
  // Simple glob: supports "*" wildcard only.
  const escaped = globPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except "*"
    .replace(/\*/g, '.*'); // convert "*" to ".*"
  const re = new RegExp(`^${escaped}$`);
  return re.test(name);
}

function normalizeSpec(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  delete clone.suppliers;
  if (typeof clone.description === 'object' && Array.isArray(clone.description)) {
    clone.description = clone.description.join('\n');
  }
  if (clone.policy && typeof clone.policy === 'string' && /^-?\d+$/.test(clone.policy)) {
    clone.policy = parseInt(clone.policy, 10);
  }
  if (clone.host && typeof clone.host === 'object') {
    if (Array.isArray(clone.host.macro)) {
      clone.host.macro = clone.host.macro.join('\n');
    }
  }
  if (clone.join && typeof clone.join === 'object') {
    if (Array.isArray(clone.join.macro)) {
      clone.join.macro = clone.join.macro.join('\n');
    }
  }
  return clone;
}

function formatJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function diffText(oldText, newText, filePath) {
  const tmpOld = path.join(logDir, `.old-${path.basename(filePath)}-${process.pid}`);
  const tmpNew = path.join(logDir, `.new-${path.basename(filePath)}-${process.pid}`);
  fs.writeFileSync(tmpOld, oldText);
  fs.writeFileSync(tmpNew, newText);
  const res = spawnSync('diff', ['-u', tmpOld, tmpNew], { encoding: 'utf8' });
  fs.unlinkSync(tmpOld);
  fs.unlinkSync(tmpNew);
  if (res.status === 0) return ''; // no diff
  return res.stdout || res.stderr;
}

const allFiles = walk(path.resolve(rootDir)).filter(f => matchesPattern(path.basename(f), pattern));

let processed = 0;
let normalized = 0;
let validationFailures = 0;
let written = 0;

const logLines = [];
logLines.push(`Normalisation run ${timestamp} (apply=${apply})`);
logLines.push(`Schema: ${schemaPath}`);
logLines.push(`Search: dir=${path.resolve(rootDir)} pattern=${pattern}`);
logLines.push('');

for (const file of allFiles) {
  processed += 1;
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    validationFailures += 1;
    logLines.push(`[PARSE-ERROR] ${file}`);
    logLines.push(`  ${err.message}`);
    logLines.push('');
    continue;
  }

  // Pre-check name against strict classification patterns
  const name = parsed && parsed.name;
  const isProtocol = parsed && parsed.type === 'protocol';
  const isSupplier = parsed && parsed.type === 'supplier';
  const class4 = /^\/(?:[a-z0-9-]+\/){3}[a-z0-9-]+$/;
  const class5 = /^\/(?:[a-z0-9-]+\/){4}[a-z0-9-]+$/;
  const nameValid = isProtocol ? class4.test(name || '') : isSupplier ? class5.test(name || '') : false;

  if (!nameValid) {
    validationFailures += 1;
    logLines.push(`[UNFIXABLE-NAME] ${file}`);
    logLines.push(`  name: ${name || '<missing>'}`);
    logLines.push(`  type: ${parsed && parsed.type ? parsed.type : '<missing>'}`);
    logLines.push('  reason: name does not match strict classification pattern; requires manual rename');
    logLines.push('');
    continue;
  }

  const normalizedObj = normalizeSpec(parsed);
  const normalizedText = formatJson(normalizedObj);
  const diffs = diffText(raw, normalizedText, file);
  const valid = validate(normalizedObj);
  if (!valid) {
    validationFailures += 1;
  }
  if (diffs) {
    normalized += 1;
    logLines.push(`[NORMALIZED] ${file}`);
    logLines.push(diffs.trimEnd());
  } else {
    logLines.push(`[UNCHANGED] ${file}`);
  }

  if (!valid) {
    logLines.push(`  [VALIDATION-FAILED]`);
    for (const err of validate.errors || []) {
      logLines.push(`    path: ${err.instancePath || '/'} schema: ${err.schemaPath} msg: ${err.message}`);
    }
  }

  if (apply && valid && diffs) {
    fs.writeFileSync(file, normalizedText, 'utf8');
    written += 1;
  }

  logLines.push('');
}

logLines.push(`Summary: processed=${processed} normalized=${normalized} validation_failures=${validationFailures} written=${written}`);
fs.writeFileSync(logFile, logLines.join('\n'), 'utf8');

console.log(`Processed: ${processed}`);
console.log(`Normalized (changed): ${normalized}`);
console.log(`Validation failures: ${validationFailures}`);
console.log(`Written (applied): ${written}`);
console.log(`Log: ${logFile}`);
