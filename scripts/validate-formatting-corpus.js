#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_ROOT = path.join(ROOT, ".ops", "diagnostics-lab");
const DEFAULT_CORPUS_DIR = path.join(LOCAL_ROOT, "corpus");
const DEFAULT_RUNS_DIR = path.join(LOCAL_ROOT, "runs", "formatting");
const FORMATTER_MODULE_PATH = path.join(ROOT, "server", "out", "formatting.js");
const TEXT_DOCUMENT_MODULE_PATH = path.join(ROOT, "server", "node_modules", "vscode-languageserver-textdocument");

function parseArgs(argv) {
  const args = {
    corpusDir: DEFAULT_CORPUS_DIR,
    runsDir: DEFAULT_RUNS_DIR,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--corpus" && argv[index + 1]) {
      args.corpusDir = path.resolve(argv[++index]);
      continue;
    }
    if (arg === "--runs-dir" && argv[index + 1]) {
      args.runsDir = path.resolve(argv[++index]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/validate-formatting-corpus.js [options]

Options:
  --corpus <dir>       Directory containing .dla and .dlp files (default: ${DEFAULT_CORPUS_DIR})
  --runs-dir <dir>     Directory for formatter run artifacts (default: ${DEFAULT_RUNS_DIR})
  -h, --help           Show help
`);
}

function listExpressionFiles(rootDir) {
  const files = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && /\.(dla|dlp)$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function timestamp() {
  const date = new Date();
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function countChangedLines(source, formatted) {
  const sourceLines = source.replace(/\r\n/g, "\n").split("\n");
  const formattedLines = formatted.replace(/\r\n/g, "\n").split("\n");
  const lineCount = Math.max(sourceLines.length, formattedLines.length);
  let changedLines = 0;
  for (let index = 0; index < lineCount; index += 1) {
    if (sourceLines[index] !== formattedLines[index]) {
      changedLines += 1;
    }
  }
  return changedLines;
}

function loadDependencies() {
  if (!fs.existsSync(FORMATTER_MODULE_PATH)) {
    throw new Error(`Missing compiled formatter at ${FORMATTER_MODULE_PATH}. Run 'npm run build:server' first.`);
  }
  const formatter = require(FORMATTER_MODULE_PATH);
  const { TextDocument } = require(TEXT_DOCUMENT_MODULE_PATH);
  return { formatter, TextDocument };
}

function formatFile(filePath, source, dependencies) {
  const { formatter, TextDocument } = dependencies;
  const uri = `file://${filePath.replace(/\\/g, "/")}`;
  const applyFormatting = (text, version) => {
    const document = TextDocument.create(uri, "emergent", version, text);
    const input = formatter.buildFormattingInput(document);
    const decisions = formatter.planFormatting(input, { startLine: 0, endLine: document.lineCount - 1 });
    const edits = formatter.emitFormattingEdits(document, decisions);
    return { input, edits, formatted: TextDocument.applyEdits(document, edits) };
  };
  const firstPass = applyFormatting(source, 1);
  const secondPass = applyFormatting(firstPass.formatted, 2);

  return {
    parseMode: firstPass.input.parseMode,
    editCount: firstPass.edits.length,
    formatted: firstPass.formatted,
    idempotent: secondPass.edits.length === 0,
    secondPassEditCount: secondPass.edits.length,
  };
}

function createEmptyModeCounts() {
  return {
    parsed: { files: 0, changedFiles: 0, changedLines: 0, idempotenceFailures: 0 },
    recovery: { files: 0, changedFiles: 0, changedLines: 0, idempotenceFailures: 0 },
  };
}

function validateCorpus(args, dependencies = loadDependencies()) {
  if (!fs.existsSync(args.corpusDir)) {
    throw new Error(`Corpus directory not found: ${args.corpusDir}`);
  }

  const runDir = path.join(args.runsDir, timestamp());
  const formattedDir = path.join(runDir, "formatted");
  fs.mkdirSync(formattedDir, { recursive: true });

  const files = listExpressionFiles(args.corpusDir);
  const records = [];
  const modeCounts = createEmptyModeCounts();
  let changedFiles = 0;
  let changedLines = 0;
  let totalEdits = 0;
  let idempotenceFailures = 0;
  let fileFailures = 0;

  for (const filePath of files) {
    const relativePath = path.relative(args.corpusDir, filePath).replace(/\\/g, "/");
    const source = fs.readFileSync(filePath, "utf8");
    const record = { file: relativePath, sourceHash: sha1(source) };
    try {
      const result = formatFile(filePath, source, dependencies);
      const changed = source !== result.formatted;
      const fileChangedLines = changed ? countChangedLines(source, result.formatted) : 0;
      Object.assign(record, {
        formattedHash: sha1(result.formatted),
        parseMode: result.parseMode,
        changed,
        editCount: result.editCount,
        changedLines: fileChangedLines,
        idempotent: result.idempotent,
        secondPassEditCount: result.secondPassEditCount,
      });

      const counts = modeCounts[result.parseMode];
      counts.files += 1;
      counts.changedLines += fileChangedLines;
      totalEdits += result.editCount;
      changedLines += fileChangedLines;
      if (changed) {
        changedFiles += 1;
        counts.changedFiles += 1;
        const formattedPath = path.join(formattedDir, relativePath);
        fs.mkdirSync(path.dirname(formattedPath), { recursive: true });
        fs.writeFileSync(formattedPath, result.formatted, "utf8");
      }
      if (!result.idempotent) {
        idempotenceFailures += 1;
        counts.idempotenceFailures += 1;
      }
    } catch (error) {
      fileFailures += 1;
      Object.assign(record, { error: error instanceof Error ? error.message : String(error) });
    }
    records.push(record);
  }

  const largestDiffs = records
    .filter((record) => record.changed)
    .sort((left, right) => right.changedLines - left.changedLines || left.file.localeCompare(right.file))
    .slice(0, 20)
    .map(({ file, parseMode, editCount, changedLines }) => ({ file, parseMode, editCount, changedLines }));
  const summary = {
    corpusDir: args.corpusDir,
    runDir,
    filesScanned: files.length,
    changedFiles,
    changedLines,
    totalEdits,
    idempotenceFailures,
    fileFailures,
    parseModes: modeCounts,
    largestDiffs,
  };

  fs.writeFileSync(path.join(runDir, "changes.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf8");
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  return { runDir, summary, records };
}

function main() {
  const result = validateCorpus(parseArgs(process.argv));
  console.log(
    `Formatter corpus run: ${result.summary.filesScanned} files, ${result.summary.changedFiles} changed, ` +
      `${result.summary.idempotenceFailures} idempotence failures, ${result.summary.fileFailures} execution failures.`
  );
  console.log(`Artifacts: ${result.runDir}`);
  if (result.summary.idempotenceFailures > 0 || result.summary.fileFailures > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { countChangedLines, listExpressionFiles, parseArgs, validateCorpus };
