#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_ROOT = path.join(ROOT, ".ops", "diagnostics-lab");
const DEFAULT_RUNS_DIR = path.join(LOCAL_ROOT, "runs");
const DEFAULT_TAGS_FILE = path.join(LOCAL_ROOT, "tags", "diagnostic-tags.jsonl");
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

function parseArgs(argv) {
  const args = {
    runFile: null,
    runsDir: DEFAULT_RUNS_DIR,
    tagsFile: DEFAULT_TAGS_FILE,
    limit: 20,
    includeTagged: false,
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
    if (arg === "--limit" && argv[i + 1]) {
      args.limit = Number(argv[++i]);
      continue;
    }
    if (arg === "--include-tagged") {
      args.includeTagged = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) {
    throw new Error(`--limit must be a positive number, got: ${args.limit}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/triage-diagnostics.js [options]

Options:
  --run-file <file>      Diagnostics JSONL file (default: latest run)
  --runs-dir <dir>       Runs directory (default: ${DEFAULT_RUNS_DIR})
  --tags <file>          Tags JSONL file (default: ${DEFAULT_TAGS_FILE})
  --limit <num>          Number of diagnostics to triage (default: 20)
  --include-tagged       Include already-tagged diagnostics
  -h, --help             Show help

Labels:
  t = tp
  f = fp
  m = missing
  u = unclear
  s = skip
  q = quit
`);
}

function findLatestRunFile(runsDir) {
  if (!fs.existsSync(runsDir)) {
    throw new Error(`Runs directory not found: ${runsDir}`);
  }
  const runDirs = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (!runDirs.length) {
    throw new Error(`No run directories found in: ${runsDir}`);
  }
  const latest = runDirs[runDirs.length - 1];
  const runFile = path.join(runsDir, latest, "diagnostics.jsonl");
  if (!fs.existsSync(runFile)) {
    throw new Error(`Diagnostics file not found in latest run: ${runFile}`);
  }
  return runFile;
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

function appendJsonl(filePath, records) {
  if (!records.length) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(filePath, content, "utf8");
}

function loadRunSummary(runFile) {
  const summaryFile = path.join(path.dirname(runFile), "summary.json");
  if (!fs.existsSync(summaryFile)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(summaryFile, "utf8"));
  } catch {
    return null;
  }
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function checkSourceDrift(item, corpusDir) {
  if (!corpusDir) {
    return null;
  }
  const filePath = path.join(corpusDir, item.file);
  if (!fs.existsSync(filePath)) {
    return { kind: "missing", filePath };
  }
  if (!item.sourceHash) {
    return null;
  }
  const current = fs.readFileSync(filePath, "utf8");
  const currentHash = sha1(current);
  if (currentHash !== item.sourceHash) {
    return { kind: "changed", filePath };
  }
  return null;
}

function printContext(item, corpusDir) {
  if (!corpusDir) {
    return;
  }
  const filePath = path.join(corpusDir, item.file);
  if (!fs.existsSync(filePath)) {
    console.log("(context unavailable: source file not found)");
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const diagLine = Number(item?.range?.start?.line ?? 0);
  const start = Math.max(0, diagLine - 1);
  const end = Math.min(lines.length - 1, diagLine + 2);
  console.log("Context:");
  for (let i = start; i <= end; i++) {
    const marker = i === diagLine ? ">" : " ";
    const num = String(i + 1).padStart(5, " ");
    console.log(`${marker} ${num} | ${lines[i] ?? ""}`);
  }
  if (typeof item.lineTextAtRun === "string" && item.lineTextAtRun !== lines[diagLine]) {
    console.log(`Run line text: ${item.lineTextAtRun}`);
  }
}

function printOpenTarget(item, corpusDir) {
  if (!corpusDir) {
    return;
  }
  const filePath = path.join(corpusDir, item.file);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const line = Number(item?.range?.start?.line ?? 0) + 1;
  const column = Number(item?.range?.start?.character ?? 0) + 1;
  const gotoTarget = `${filePath}:${line}:${column}`;
  console.log(`Open target: ${gotoTarget}`);
  console.log(`Open command: code --goto "${gotoTarget}"`);
}

function sortByFrequency(records) {
  const byMessage = new Map();
  for (const record of records) {
    const key = String(record.message || "").toLowerCase().trim();
    byMessage.set(key, (byMessage.get(key) || 0) + 1);
  }
  return records.slice().sort((a, b) => {
    const aKey = String(a.message || "").toLowerCase().trim();
    const bKey = String(b.message || "").toLowerCase().trim();
    const freqDelta = (byMessage.get(bKey) || 0) - (byMessage.get(aKey) || 0);
    if (freqDelta !== 0) return freqDelta;
    const fileDelta = String(a.file).localeCompare(String(b.file));
    if (fileDelta !== 0) return fileDelta;
    return String(a.id).localeCompare(String(b.id));
  });
}

function mapKeyToLabel(key) {
  switch (key.toLowerCase()) {
    case "t":
      return "tp";
    case "f":
      return "fp";
    case "m":
      return "missing";
    case "u":
      return "unclear";
    default:
      return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const runFile = args.runFile || findLatestRunFile(args.runsDir);
  const runSummary = loadRunSummary(runFile);
  const corpusDir = runSummary?.corpusDir ? path.resolve(runSummary.corpusDir) : null;
  const diagnostics = loadJsonl(runFile);
  const existingTags = loadJsonl(args.tagsFile);
  const taggedIds = new Set(existingTags.map((tag) => tag.id));
  const source = args.includeTagged
    ? diagnostics
    : diagnostics.filter((d) => !taggedIds.has(d.id));
  const queue = sortByFrequency(source).slice(0, args.limit);

  if (!queue.length) {
    console.log("No diagnostics available for triage with current filters.");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log(`Run file: ${runFile}`);
  console.log(`Tags file: ${args.tagsFile}`);
  console.log(`Items queued: ${queue.length}`);

  const newTags = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    console.log("");
    console.log(`[${i + 1}/${queue.length}] ${item.id}`);
    console.log(`${item.file}:${item.range.start.line + 1}:${item.range.start.character + 1}`);
    console.log(`${ANSI_YELLOW}${item.message}${ANSI_RESET}`);
    const drift = checkSourceDrift(item, corpusDir);
    if (drift?.kind === "missing") {
      console.log(`Warning: source file no longer exists at ${drift.filePath}`);
    } else if (drift?.kind === "changed") {
      console.log("Warning: source file changed since diagnostics run; line/range may not match current contents.");
      console.log("Hint: rerun `npm run validate:corpus` before triage for exact alignment.");
    }
    printOpenTarget(item, corpusDir);
    printContext(item, corpusDir);
    const answerRaw = await ask("[t]p [f]p [m]issing [u]nclear [s]kip [q]uit > ");
    const answer = String(answerRaw || "").trim();
    if (!answer) {
      i -= 1;
      continue;
    }
    if (answer.toLowerCase() === "q") {
      break;
    }
    if (answer.toLowerCase() === "s") {
      continue;
    }
    const label = mapKeyToLabel(answer[0]);
    if (!label) {
      console.log("Invalid choice. Use t/f/m/u/s/q.");
      i -= 1;
      continue;
    }
    const note = String(await ask("note (optional, enter to skip) > ")).trim();
    newTags.push({
      id: item.id,
      label,
      note,
      file: item.file,
      message: item.message,
      taggedAt: new Date().toISOString(),
    });
  }

  rl.close();
  appendJsonl(args.tagsFile, newTags);
  console.log(`Saved tags: ${newTags.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
