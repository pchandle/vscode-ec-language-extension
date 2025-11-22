#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const ROOT_DOC = path.join(__dirname, '..', 'docs', 'example-root-document.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'fetched-specs');
const CONCURRENCY = 20;
const TIMEOUT_MS = 15000;

function loadRootDoc() {
  const content = fs.readFileSync(ROOT_DOC, 'utf8');
  return JSON.parse(content);
}

function buildUrl(host, specPath) {
  // specPath already begins with '/', so keep the double slash expected by the API
  return `http://${host}/api/valley/fetch/${specPath}`;
}

function outputPathFor(specPath) {
  const flattened = specPath.replace(/^\//, '').replace(/\//g, '--');
  return path.join(OUTPUT_DIR, `${flattened}.json`);
}

async function saveResponse(filePath, body) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, body);
}

async function fetchOne(host, specPath) {
  const url = buildUrl(host, specPath);
  const res = await fetch(url, { timeout: TIMEOUT_MS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

async function run() {
  const specs = loadRootDoc();
  const tasks = Object.entries(specs).map(([specPath, host]) => ({ specPath, host }));
  let nextIndex = 0;
  let success = 0;
  const failures = [];

  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const current = nextIndex < tasks.length ? tasks[nextIndex++] : null;
      if (!current) break;
      const { specPath, host } = current;
      const outPath = outputPathFor(specPath);
      try {
        const body = await fetchOne(host, specPath);
        await saveResponse(outPath, body);
        success += 1;
      } catch (err) {
        failures.push({ specPath, host, error: err.message });
        console.error(`Failed: ${specPath} @ ${host} -> ${err.message}`);
      }
    }
  });

  await Promise.all(workers);

  console.log(`Fetched ${success} / ${tasks.length}`);
  if (failures.length) {
    console.log(`Failures (${failures.length}):`);
    failures.slice(0, 10).forEach(f => {
      console.log(`- ${f.specPath} @ ${f.host}: ${f.error}`);
    });
    if (failures.length > 10) {
      console.log(`...and ${failures.length - 10} more`);
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
