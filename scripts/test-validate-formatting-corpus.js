#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { validateCorpus } = require("./validate-formatting-corpus");

const temporaryRoot = process.env.TMPDIR || "/tmp";
const root = fs.mkdtempSync(path.join(temporaryRoot, "ec-formatting-corpus-"));
const corpusDir = path.join(root, "corpus");
const runsDir = path.join(root, "runs");
fs.mkdirSync(path.join(corpusDir, "nested"), { recursive: true });

const parsedPath = path.join(corpusDir, "parsed.dla");
const recoveryPath = path.join(corpusDir, "nested", "recovery.dlp");
const ignoredPath = path.join(corpusDir, "ignored.txt");
fs.writeFileSync(parsedPath, "sub /data/test($)  ->out   \n", "utf8");
fs.writeFileSync(recoveryPath, "if ready then\n  sub /data/test($)  ->out\n", "utf8");
fs.writeFileSync(ignoredPath, "ignore me\n", "utf8");

try {
  const result = validateCorpus({ corpusDir, runsDir });
  assert.strictEqual(result.summary.filesScanned, 2);
  assert.strictEqual(result.summary.fileFailures, 0);
  assert.strictEqual(result.summary.idempotenceFailures, 0);
  assert.strictEqual(result.summary.parseModes.parsed.files, 1);
  assert.strictEqual(result.summary.parseModes.recovery.files, 1);
  assert.strictEqual(fs.readFileSync(parsedPath, "utf8"), "sub /data/test($)  ->out   \n");
  assert.strictEqual(fs.readFileSync(recoveryPath, "utf8"), "if ready then\n  sub /data/test($)  ->out\n");
  assert.ok(fs.existsSync(path.join(result.runDir, "summary.json")));
  assert.ok(fs.existsSync(path.join(result.runDir, "changes.jsonl")));
  assert.ok(fs.existsSync(path.join(result.runDir, "formatted", "parsed.dla")));
  assert.ok(fs.existsSync(path.join(result.runDir, "formatted", "nested", "recovery.dlp")));

  const unstableCorpusDir = path.join(root, "unstable-corpus");
  fs.mkdirSync(unstableCorpusDir);
  fs.writeFileSync(path.join(unstableCorpusDir, "unstable.dla"), "once", "utf8");
  const unstableResult = validateCorpus(
    { corpusDir: unstableCorpusDir, runsDir },
    {
      TextDocument: {
        create: (uri, _language, _version, text) => ({ uri, text }),
        applyEdits: (document, edits) => (edits.length > 0 ? edits[0].newText : document.text),
      },
      formatter: {
        buildFormattingInput: () => ({ parseMode: "parsed" }),
        planFormatting: () => [],
        emitFormattingEdits: (document) => [{ newText: document.text === "once" ? "twice" : "thrice" }],
      },
    }
  );
  assert.strictEqual(unstableResult.summary.idempotenceFailures, 1);
  assert.strictEqual(unstableResult.records[0].idempotent, false);
  console.log("Formatter corpus runner tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
