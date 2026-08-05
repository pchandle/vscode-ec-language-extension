const fs = require("fs");
const path = require("path");
const AjvDraft7 = require("ajv").default;
const Ajv2020 = require("ajv/dist/2020").default;

const root = path.resolve(__dirname, "..");
const manifest = require(path.join(root, "package.json"));
const configurationGuide = read("docs/user/configuration.md");
const userGuide = read("docs/user/user-guide.md");
const markdownFiles = trackedMarkdownFiles();

for (const file of markdownFiles) validateMarkdownLinks(file);
validateManifestCoverage();
validateReferenceExamples();
console.log(`Documentation checks passed (${markdownFiles.length} Markdown files).`);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function trackedMarkdownFiles() {
  const result = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      if (["node_modules", ".git", ".vscode-test", ".ops", "out"].includes(entry.name)) continue;
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(child);
    }
  };
  visit(".");
  return result;
}

function validateMarkdownLinks(relativePath) {
  const source = read(relativePath);
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:|command:)/.test(target)) continue;
    const [filePart, rawAnchor] = target.split("#", 2);
    const targetPath = filePart ? path.resolve(path.dirname(path.join(root, relativePath)), filePart) : path.join(root, relativePath);
    if (!targetPath.startsWith(root + path.sep) && targetPath !== root) fail(`${relativePath}: link escapes repository: ${target}`);
    if (!fs.existsSync(targetPath)) fail(`${relativePath}: missing link target: ${target}`);
    if (rawAnchor) {
      const targetSource = fs.readFileSync(targetPath, "utf8");
      const anchors = new Set([...targetSource.matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) => slug(heading[1])));
      if (!anchors.has(rawAnchor)) fail(`${relativePath}: missing anchor #${rawAnchor} in ${target}`);
    }
  }
}

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-");
}

function validateManifestCoverage() {
  const settings = manifest.contributes.configuration.flatMap((group) => Object.keys(group.properties));
  for (const setting of settings) {
    if (!configurationGuide.includes(`\`${setting}\``)) fail(`Configuration guide does not document ${setting}`);
  }
  for (const command of manifest.contributes.commands) {
    if (!userGuide.includes(`**${command.title}**`)) fail(`User guide does not document command ${command.title}`);
  }
  for (const keybinding of manifest.contributes.keybindings) {
    const key = keybinding.key.replace(/ctrl/g, "Ctrl").replace(/alt/g, "Alt").replace(/shift/g, "Shift");
    const mac = (keybinding.mac || "").replace(/cmd/g, "Cmd").replace(/alt/g, "Alt").replace(/shift/g, "Shift");
    if (!userGuide.toLowerCase().includes(`\`${key}\``.toLowerCase()) || !userGuide.toLowerCase().includes(`\`${mac}\``.toLowerCase())) {
      fail(`User guide does not document keybinding for ${keybinding.command}`);
    }
  }
}

function validateReferenceExamples() {
  const examples = path.join(root, "docs/developer/diagnostics/examples");
  const draft7 = new AjvDraft7({ allErrors: true, strict: false, validateSchema: false });
  const draft2020 = new Ajv2020({ allErrors: true, strict: false });
  const schemas = {
    ".cspec": { validator: draft7.compile(require(path.join(root, "docs/developer/spec.schema.json"))) },
    ".pspec": { validator: draft7.compile(require(path.join(root, "docs/developer/spec.schema.json"))) },
    ".pdd": { validator: draft2020.compile(require(path.join(root, "docs/developer/pdd.schema.json"))) },
    ".pdes": { validator: draft2020.compile(require(path.join(root, "media/pdes.schema.json"))) },
  };
  for (const entry of fs.readdirSync(examples)) {
    const extension = path.extname(entry);
    const schema = schemas[extension];
    if (!schema) continue;
    const relativePath = path.join("docs/developer/diagnostics/examples", entry);
    let value;
    try {
      value = JSON.parse(read(relativePath));
    } catch (error) {
      fail(`${relativePath}: invalid JSON (${error.message})`);
    }
    if (!schema.validator(value)) fail(`${relativePath}: ${formatErrors(schema.validator.errors)}`);
  }
}

function formatErrors(errors) {
  return (errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function fail(message) {
  throw new Error(message);
}
