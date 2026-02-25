#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_ROOT = path.join(ROOT, ".ops", "diagnostics-lab");
const DEFAULT_RUNS_DIR = path.join(LOCAL_ROOT, "runs");
const DEFAULT_TAGS_FILE = path.join(LOCAL_ROOT, "tags", "diagnostic-tags.jsonl");

function parseArgs(argv) {
  const args = {
    runFile: null,
    runsDir: DEFAULT_RUNS_DIR,
    tagsFile: DEFAULT_TAGS_FILE,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-file" && argv[i + 1]) {
      args.runFile = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--runs-dir" && argv[i + 1]) {
      args.runsDir = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--tags" && argv[i + 1]) {
      args.tagsFile = path.resolve(argv[++i]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/diagnostic-triage-report.js [--run-file <file>] [--runs-dir <dir>] [--tags <file>]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function findLatestRunFile(runsDir) {
  const runDirs = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (!runDirs.length) {
    throw new Error(`No run directories found in: ${runsDir}`);
  }
  return path.join(runsDir, runDirs[runDirs.length - 1], "diagnostics.jsonl");
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function main() {
  const args = parseArgs(process.argv);
  const runFile = args.runFile || findLatestRunFile(args.runsDir);
  const diagnostics = loadJsonl(runFile);
  const tags = loadJsonl(args.tagsFile);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));

  const labelCounts = { tp: 0, fp: 0, missing: 0, unclear: 0 };
  for (const tag of tags) {
    if (Object.prototype.hasOwnProperty.call(labelCounts, tag.label)) {
      labelCounts[tag.label] += 1;
    }
  }

  const untagged = diagnostics.filter((d) => !tagsById.has(d.id));
  const byMessage = new Map();
  for (const d of untagged) {
    const key = String(d.message || "").toLowerCase().trim();
    byMessage.set(key, (byMessage.get(key) || 0) + 1);
  }
  const topUntaggedMessages = Array.from(byMessage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log(`Run file: ${runFile}`);
  console.log(`Diagnostics total: ${diagnostics.length}`);
  console.log(`Tagged ids present in run: ${diagnostics.length - untagged.length}`);
  console.log(`Untagged diagnostics: ${untagged.length}`);
  console.log(`Tags totals: tp=${labelCounts.tp} fp=${labelCounts.fp} missing=${labelCounts.missing} unclear=${labelCounts.unclear}`);
  console.log("Top untagged messages:");
  for (const [message, count] of topUntaggedMessages) {
    console.log(`- ${count} :: ${message}`);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
