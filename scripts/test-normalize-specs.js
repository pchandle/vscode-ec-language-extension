const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const min = "-9223372036854775808";
const max = "9223372036854775807";
const larger = "123456789012345678901234567890";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "emergent-normalize-specs-"));
const filename = path.join(directory, "lossless.cspec");
const protocolFilename = path.join(directory, "lossless.pspec");

try {
  fs.writeFileSync(
    filename,
    `{
  "type": "supplier",
  "name": "/layer/verb/subject/variation/platform",
  "description": "lossless integers",
  "requirements": [
    { "type": "integer", "name": "range", "minimum": ${min}, "maximum": ${max}, "hint": "range" }
  ],
  "obligations": [
    { "type": "integer", "name": "large", "minimum": ${larger}, "maximum": ${min}, "hint": "range" },
    { "type": "string", "name": "sized", "length": ${larger}, "hint": "value" }
  ],
  "supplier": "aptissio"
}`
  );
  fs.writeFileSync(
    protocolFilename,
    `{
  "type": "protocol",
  "policy": ${larger},
  "name": "/layer/subject/variation/platform",
  "description": "lossless policy",
  "host": { "requirements": [], "obligations": [], "macro": "" },
  "join": { "requirements": [], "obligations": [], "macro": "" }
}`
  );

  const result = spawnSync(process.execPath, ["scripts/normalize-specs.js", "-apply", directory, "*"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);

  const normalized = fs.readFileSync(filename, "utf8");
  assert.match(normalized, new RegExp(`"minimum": "${min}"`));
  assert.match(normalized, new RegExp(`"maximum": "${max}"`));
  assert.match(normalized, new RegExp(`"minimum": "${larger}"`));
  assert.match(normalized, new RegExp(`"length": "${larger}"`));
  const normalizedProtocol = fs.readFileSync(protocolFilename, "utf8");
  assert.match(normalizedProtocol, new RegExp(`"policy": ${larger}`));
  assert.ok(!normalizedProtocol.includes(`"policy": "${larger}"`));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
