const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const root = path.join(__dirname, "..");
const outDir = path.join(root, "media");
const entryFile = path.join(root, "webview-src", "main.tsx");
const schemaSource = path.join(root, "docs", "spec.schema.json");

function ensureSchemaCopies() {
  if (!fs.existsSync(schemaSource)) {
    throw new Error(`Schema not found at ${schemaSource}`);
  }
  const baseSchema = JSON.parse(fs.readFileSync(schemaSource, "utf8"));
  const { $defs } = baseSchema;
  if (!$defs) {
    throw new Error("Base schema missing $defs");
  }

  const makeVariant = (rootKey, titleSuffix) => ({
    $schema: baseSchema.$schema,
    title: `${baseSchema.title} (${titleSuffix})`,
    $ref: `#/$defs/${rootKey}`,
    $defs,
  });

  const targets = [
    { name: "spec.schema.json", data: baseSchema },
    { name: "contractSpec.schema.json", data: makeVariant("supplierSpec", "Contract") },
    { name: "protocolSpec.schema.json", data: makeVariant("protocolSpec", "Protocol") },
  ];

  fs.mkdirSync(outDir, { recursive: true });
  for (const target of targets) {
    const targetPath = path.join(outDir, target.name);
    fs.writeFileSync(targetPath, JSON.stringify(target.data, null, 2));
  }
}

async function build() {
  ensureSchemaCopies();

  const buildOptions = {
    entryPoints: [entryFile],
    outfile: path.join(outDir, "main.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome105"],
    sourcemap: true,
    jsx: "automatic",
    logLevel: "info",
    loader: {
      ".svg": "dataurl",
      ".png": "dataurl",
    },
  };

  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("webview build watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log("webview build complete");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
