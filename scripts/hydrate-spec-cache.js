#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_ROOT = path.join(ROOT, ".ops", "diagnostics-lab");
const DEFAULT_CORPUS_DIR = path.join(LOCAL_ROOT, "corpus");
const DEFAULT_CACHE_FILE = path.join(LOCAL_ROOT, "tmp", "contractCache.json");
const PARSER_MODULE_PATH = path.join(ROOT, "server", "out", "lang", "parser.js");
const NORMALIZATION_MODULE_PATH = path.join(ROOT, "server", "out", "lang", "normalization.js");
const COMPLETION_MODULE_PATH = path.join(ROOT, "server", "out", "completionSupport.js");

function parseArgs(argv) {
  const args = {
    corpusDir: DEFAULT_CORPUS_DIR,
    cacheFile: DEFAULT_CACHE_FILE,
    apiRoot: "http://localhost:10000",
    specPathPrefix: "",
    concurrency: 16,
    timeoutMs: 15000,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--corpus" && argv[i + 1]) {
      args.corpusDir = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--cache" && argv[i + 1]) {
      args.cacheFile = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--api-root" && argv[i + 1]) {
      args.apiRoot = String(argv[++i]);
      continue;
    }
    if (arg === "--spec-path-prefix" && argv[i + 1]) {
      args.specPathPrefix = String(argv[++i]);
      continue;
    }
    if (arg === "--concurrency" && argv[i + 1]) {
      args.concurrency = Number(argv[++i]);
      continue;
    }
    if (arg === "--timeout-ms" && argv[i + 1]) {
      args.timeoutMs = Number(argv[++i]);
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) {
    throw new Error(`--concurrency must be a positive number, got: ${args.concurrency}`);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`--timeout-ms must be a positive number, got: ${args.timeoutMs}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/hydrate-spec-cache.js [options]

Options:
  --corpus <dir>            Directory containing .dla files (default: ${DEFAULT_CORPUS_DIR})
  --cache <file>            Path to contractCache.json (default: ${DEFAULT_CACHE_FILE})
  --api-root <url>          Gateway root URL fallback (default: http://localhost:10000)
  --spec-path-prefix <path> Override spec path prefix from cache
  --concurrency <num>       Parallel fetch workers (default: 16)
  --timeout-ms <num>        Per-request timeout in milliseconds (default: 15000)
  --dry-run                 Discover/fetch summary only; do not write cache
  -h, --help                Show help
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

function stripClassification(raw) {
  return String(raw || "")
    .split("@")[0]
    .split("(")[0]
    .trim();
}

function collectClassificationsFromProgram(program, defaults, normalizeContractClassification, normalizeProtocolClassification) {
  const out = new Set();

  const collect = (statements) => {
    for (const stmt of statements || []) {
      const raw = stmt?.classification?.lexeme;
      if (raw) {
        const keyword = String(stmt?.keyword?.lexeme || "").toLowerCase();
        const cleanedRaw = stripClassification(raw);
        const normalized =
          keyword === "host" || keyword === "join"
            ? normalizeProtocolClassification(cleanedRaw, defaults)
            : normalizeContractClassification(cleanedRaw, defaults);
        if (normalized) {
          out.add(normalized);
        } else if (cleanedRaw.startsWith("/")) {
          out.add(cleanedRaw);
        }
      }

      if (stmt?.body?.statements) {
        collect(stmt.body.statements);
      }
      if (stmt?.block?.statements) {
        collect(stmt.block.statements);
      }
    }
  };

  collect(program?.statements || []);
  return out;
}

function buildSpecUrl(base, prefix, classification) {
  // Mirror language-server behavior: `${apiRoot}${specPathPrefix}${classification}`.
  // Keep any trailing slash in prefix so legacy paths like `/fetch//<classification>` are preserved.
  const root = String(base || "").replace(/\/+$/, "");
  const pre = String(prefix || "");
  const cls = String(classification || "");
  return `${root}${pre}${cls}`;
}

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, {
    timeout: timeoutMs,
    headers: { "cache-control": "no-cache" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response");
  }
}

async function withConcurrency(items, workerCount, workerFn) {
  let index = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = index;
      index += 1;
      if (i >= items.length) {
        return;
      }
      await workerFn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function ensureCompiledModules() {
  const missing = [PARSER_MODULE_PATH, NORMALIZATION_MODULE_PATH, COMPLETION_MODULE_PATH].filter(
    (p) => !fs.existsSync(p)
  );
  if (missing.length) {
    throw new Error(
      `Missing compiled server modules. Run 'npm run build:server' first. Missing:\n${missing.join("\n")}`
    );
  }
}

function mainSummary(lines) {
  console.log("\nHydration summary");
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  ensureCompiledModules();

  if (!fs.existsSync(args.corpusDir)) {
    throw new Error(`Corpus directory not found: ${args.corpusDir}`);
  }
  if (!fs.existsSync(args.cacheFile)) {
    throw new Error(`Cache file not found: ${args.cacheFile}`);
  }

  const { parseText } = require(PARSER_MODULE_PATH);
  const { normalizeContractClassification, normalizeProtocolClassification } = require(NORMALIZATION_MODULE_PATH);
  const { getDefaultsFromText } = require(COMPLETION_MODULE_PATH);

  const cache = JSON.parse(fs.readFileSync(args.cacheFile, "utf8"));
  cache.specCache = typeof cache.specCache === "object" && cache.specCache ? cache.specCache : {};
  cache.rootDocument = typeof cache.rootDocument === "object" && cache.rootDocument ? cache.rootDocument : {};

  const specPrefix = args.specPathPrefix || cache.specPathPrefix || "/fetch/";
  const files = listDlaFiles(args.corpusDir);

  const wanted = new Set();
  let parseErrors = 0;
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const defaults = getDefaultsFromText(text) || { layer: "", variation: "", platform: "" };
    const { program, diagnostics } = parseText(text);
    if (diagnostics && diagnostics.length) {
      parseErrors += diagnostics.length;
    }
    const found = collectClassificationsFromProgram(
      program,
      defaults,
      normalizeContractClassification,
      normalizeProtocolClassification
    );
    for (const cls of found) {
      wanted.add(cls);
    }
  }

  const wantedList = Array.from(wanted).sort();
  const missing = wantedList.filter((cls) => !cache.specCache[cls]);

  let fetched = 0;
  let failed = 0;
  let processed = 0;
  const failures = [];
  const failureByError = new Map();
  const progressStarted = Date.now();
  let lastProgressAt = 0;

  const reportProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 800) {
      return;
    }
    lastProgressAt = now;
    const total = missing.length;
    const elapsedSec = Math.max(1, Math.floor((now - progressStarted) / 1000));
    const rate = processed / elapsedSec;
    const pct = total ? ((processed / total) * 100).toFixed(1) : "100.0";
    const line =
      `Hydrating specs: ${processed}/${total} (${pct}%)` +
      ` | fetched=${fetched} failed=${failed}` +
      ` | ${rate.toFixed(1)}/s`;
    process.stdout.write(`\r${line}`);
    if (force) {
      process.stdout.write("\n");
    }
  };

  await withConcurrency(missing, args.concurrency, async (classification) => {
    const apiRoot = args.apiRoot;
    const uniqueAttempts = [buildSpecUrl(apiRoot, specPrefix, classification)];

    let spec = null;
    let lastError = null;
    for (const url of uniqueAttempts) {
      try {
        spec = await fetchJson(url, args.timeoutMs);
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!spec) {
      failed += 1;
      failures.push({
        classification,
        error: lastError ? String(lastError.message || lastError) : "unknown error",
        attempts: uniqueAttempts,
      });
      const key = lastError ? String(lastError.message || lastError) : "unknown error";
      failureByError.set(key, (failureByError.get(key) || 0) + 1);
      processed += 1;
      reportProgress();
      return;
    }

    cache.specCache[classification] = spec;
    fetched += 1;
    processed += 1;
    reportProgress();
  });
  reportProgress(true);

  if (!args.dryRun) {
    fs.mkdirSync(path.dirname(args.cacheFile), { recursive: true });
    fs.writeFileSync(args.cacheFile, JSON.stringify(cache, null, 2), "utf8");
  }

  const summaryLines = [
    `Corpus files scanned: ${files.length}`,
    `Referenced classifications: ${wantedList.length}`,
    `Existing spec payloads before run: ${Object.keys(cache.specCache).length - fetched}`,
    `Missing payloads before run: ${missing.length}`,
    `Fetched payloads: ${fetched}`,
    `Fetch failures: ${failed}`,
    `Parse diagnostics observed while scanning: ${parseErrors}`,
    `Cache file ${args.dryRun ? "not written (dry run)" : "updated"}: ${args.cacheFile}`,
  ];
  mainSummary(summaryLines);

  if (failures.length) {
    console.log("\nTop fetch failures:");
    for (const item of failures.slice(0, 20)) {
      console.log(`- ${item.classification}: ${item.error}`);
    }
    if (failures.length > 20) {
      console.log(`- ... ${failures.length - 20} additional failures`);
    }

    console.log("\nFailure reasons:");
    for (const [reason, count] of Array.from(failureByError.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`- ${count}x ${reason}`);
    }
  }

  if (failed > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
