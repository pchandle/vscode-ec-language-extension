#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_ROOT = path.join(ROOT, ".ops", "diagnostics-lab");
const DEFAULT_CORPUS_DIR = path.join(LOCAL_ROOT, "corpus");
const DEFAULT_RUNS_DIR = path.join(LOCAL_ROOT, "runs");
const DEFAULT_BASELINE_FILE = path.join(LOCAL_ROOT, "baseline", "current.jsonl");
const DEFAULT_CACHE_FILE = path.join(LOCAL_ROOT, "tmp", "contractCache.json");
const DIAGNOSTICS_MODULE_PATH = path.join(ROOT, "server", "out", "diagnostics.js");

function parseArgs(argv) {
  const args = {
    corpusDir: DEFAULT_CORPUS_DIR,
    runsDir: DEFAULT_RUNS_DIR,
    baseline: DEFAULT_BASELINE_FILE,
    cacheFile: DEFAULT_CACHE_FILE,
    maxProblems: 1000,
    updateBaseline: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--corpus" && argv[i + 1]) {
      args.corpusDir = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--runs-dir" && argv[i + 1]) {
      args.runsDir = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--baseline" && argv[i + 1]) {
      args.baseline = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--max-problems" && argv[i + 1]) {
      args.maxProblems = Number(argv[++i]);
      continue;
    }
    if (arg === "--cache" && argv[i + 1]) {
      args.cacheFile = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--no-cache") {
      args.cacheFile = "";
      continue;
    }
    if (arg === "--update-baseline") {
      args.updateBaseline = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.maxProblems) || args.maxProblems <= 0) {
    throw new Error(`--max-problems must be a positive number, got: ${args.maxProblems}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-dla-corpus.js [options]

Options:
  --corpus <dir>         Directory containing .dla files (default: ${DEFAULT_CORPUS_DIR})
  --runs-dir <dir>       Directory for run outputs (default: ${DEFAULT_RUNS_DIR})
  --baseline <file>      Baseline JSONL file (default: ${DEFAULT_BASELINE_FILE})
  --cache <file>         Contract cache JSON file (default: ${DEFAULT_CACHE_FILE})
  --no-cache             Disable loading any specification cache
  --max-problems <num>   Max diagnostics per file (default: 1000)
  --update-baseline      Overwrite baseline file from current run output
  -h, --help             Show help
`);
}

function listDlaFiles(rootDir) {
  const results = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && full.toLowerCase().endsWith(".dla")) {
        results.push(full);
      }
    }
  }
  return results.sort();
}

function normalizeMessage(message) {
  return String(message || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function makeId(relPath, diagnostic) {
  const key = [
    relPath,
    diagnostic.range.start.line,
    diagnostic.range.start.character,
    diagnostic.range.end.line,
    diagnostic.range.end.character,
    diagnostic.source || "",
    normalizeMessage(diagnostic.message),
  ].join("|");
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function detectExternalCachePath() {
  const candidates = [];
  const home = process.env.HOME || "";
  const user = process.env.USER || process.env.USERNAME || "";
  if (home) {
    candidates.push(path.join(home, ".emergent", "contractCache.json"));
  }
  if (user) {
    candidates.push(path.join("/mnt/c/Users", user, ".emergent", "contractCache.json"));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function loadSpecCache(cacheFile) {
  if (!cacheFile) {
    return { specs: undefined, cachePath: null, specCount: 0 };
  }
  if (!fs.existsSync(cacheFile)) {
    const detected = detectExternalCachePath();
    if (!detected) {
      return { specs: undefined, cachePath: null, specCount: 0 };
    }
    cacheFile = detected;
  }
  const payload = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  const specs = payload && typeof payload.specCache === "object" ? payload.specCache : undefined;
  return {
    specs,
    cachePath: cacheFile,
    specCount: specs ? Object.keys(specs).length : 0,
  };
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function writeJsonl(filePath, records) {
  const lines = records.map((record) => JSON.stringify(record));
  fs.writeFileSync(filePath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}

function main() {
  if (!fs.existsSync(DIAGNOSTICS_MODULE_PATH)) {
    throw new Error(
      `Missing compiled diagnostics module at ${DIAGNOSTICS_MODULE_PATH}. Run 'npm run build:server' first.`
    );
  }
  const { collectDiagnostics } = require(DIAGNOSTICS_MODULE_PATH);

  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.corpusDir)) {
    throw new Error(`Corpus directory not found: ${args.corpusDir}`);
  }
  const { specs, cachePath, specCount } = loadSpecCache(args.cacheFile);

  fs.mkdirSync(args.runsDir, { recursive: true });
  const runDir = path.join(args.runsDir, timestamp());
  fs.mkdirSync(runDir, { recursive: true });

  const files = listDlaFiles(args.corpusDir);
  const records = [];
  let filesWithDiagnostics = 0;
  const byMessage = new Map();
  const byFile = new Map();

  const { getDefaultsFromText } = require(path.join(ROOT, "server", "out", "completionSupport.js"));
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const sourceHash = sha1(text);
    const lines = text.split(/\r?\n/);
    const relPath = path.relative(args.corpusDir, filePath).replace(/\\/g, "/");
    const doc = {
      uri: `file://${filePath.replace(/\\/g, "/")}`,
      getText: () => text,
    };
    const defaults = getDefaultsFromText(text) || undefined;
    const diagnostics = collectDiagnostics(doc, { maxNumberOfProblems: args.maxProblems }, specs, defaults);
    if (diagnostics.length > 0) {
      filesWithDiagnostics += 1;
    }
    byFile.set(relPath, diagnostics.length);

    for (const diagnostic of diagnostics) {
      const id = makeId(relPath, diagnostic);
      const messageKey = normalizeMessage(diagnostic.message);
      byMessage.set(messageKey, (byMessage.get(messageKey) || 0) + 1);
      const lineIndex = Number(diagnostic?.range?.start?.line ?? 0);
      records.push({
        id,
        file: relPath,
        sourceHash,
        source: diagnostic.source || "emergent",
        severity: diagnostic.severity,
        message: diagnostic.message,
        range: diagnostic.range,
        lineTextAtRun: lines[lineIndex] ?? "",
      });
    }
  }

  const diagnosticsFile = path.join(runDir, "diagnostics.jsonl");
  writeJsonl(diagnosticsFile, records);

  const baselineRecords = loadJsonl(args.baseline);
  const baselineIds = new Set(baselineRecords.map((record) => record.id));
  const currentIds = new Set(records.map((record) => record.id));
  const added = records.filter((record) => !baselineIds.has(record.id));
  const removed = baselineRecords.filter((record) => !currentIds.has(record.id));

  const messageTop = Array.from(byMessage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([message, count]) => ({ message, count }));

  const fileTop = Array.from(byFile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));

  const summary = {
    corpusDir: args.corpusDir,
    runDir,
    filesScanned: files.length,
    filesWithDiagnostics,
    diagnosticsTotal: records.length,
    baselineFile: args.baseline,
    cacheFileUsed: cachePath,
    cacheSpecCount: specCount,
    baselineDiagnostics: baselineRecords.length,
    addedSinceBaseline: added.length,
    removedSinceBaseline: removed.length,
    topMessages: messageTop,
    topFiles: fileTop,
  };

  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  writeJsonl(path.join(runDir, "added-vs-baseline.jsonl"), added);
  writeJsonl(path.join(runDir, "removed-vs-baseline.jsonl"), removed);

  if (args.updateBaseline) {
    fs.mkdirSync(path.dirname(args.baseline), { recursive: true });
    writeJsonl(args.baseline, records);
  }

  console.log(`Corpus: ${args.corpusDir}`);
  console.log(`Files scanned: ${summary.filesScanned}`);
  console.log(`Files with diagnostics: ${summary.filesWithDiagnostics}`);
  console.log(`Diagnostics total: ${summary.diagnosticsTotal}`);
  console.log(`Spec cache used: ${summary.cacheFileUsed ?? "none"}`);
  console.log(`Spec cache entries: ${summary.cacheSpecCount}`);
  console.log(`Added vs baseline: ${summary.addedSinceBaseline}`);
  console.log(`Removed vs baseline: ${summary.removedSinceBaseline}`);
  console.log(`Run output: ${runDir}`);
  if (args.updateBaseline) {
    console.log(`Baseline updated: ${args.baseline}`);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
