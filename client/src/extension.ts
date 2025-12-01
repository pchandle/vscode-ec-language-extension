/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { TextEncoder } from "util";
import { Valley } from "./valley";
import { SpecEditorProvider, loadSchema } from "./customEditors/SpecEditorProvider";
import { PdesEditorProvider, loadPdesSchema } from "./customEditors/PdesEditorProvider";
import { EmergentDocumentFormatter, EmergentDocumentRangeFormatter } from "./formatting";
import { registerPdesVersionCheck } from "./pdesVersionCheck";
import { registerExportProtocolSpec } from "./pdesExport";
import { workspace, ExtensionContext } from "vscode";

import * as vscode from "vscode";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

let client: LanguageClient;
let ecStatusBarItem: vscode.StatusBarItem;
let specPanel: vscode.WebviewPanel | undefined;

let lastStatusText = "initialising...";
// const contractSpecs = [];

const v = new Valley();

const valleyScanIntervalMs = 30 * 60 * 1000;

const CONTRACT_CLASSIFICATION_PATTERN = /^\/(?:[a-z0-9-]+\/){4}[a-z0-9-]+$/;
const DEFAULT_CONTRACT_FILE_EXTENSION = ".cspec";
const DEFAULT_PROTOCOL_FILE_EXTENSION = ".pspec";
const DEFAULT_CONTRACT_FILENAME_FORMAT = "{layer}--{verb}--{subject}--{variation}--{platform}";
const DEFAULT_PROTOCOL_FILENAME_FORMAT = "{layer}--{subject}--{variation}--{platform}";
const FILENAME_LITERAL_REGEX = /^[a-zA-Z0-9._-]*$/;
const CONTRACT_FILENAME_TOKENS = ["layer", "verb", "subject", "variation", "platform"];
const PROTOCOL_FILENAME_TOKENS = ["layer", "subject", "variation", "platform"];

function validateFilenameFormat(format: string, requiredTokens: string[]): string | undefined {
  if (typeof format !== "string" || !format.trim()) {
    return "Format must be a non-empty string.";
  }
  const tokenRegex = /\{([^}]+)\}/g;
  const tokensFound = new Set<string>();
  const invalidTokens: string[] = [];
  const literals: string[] = [];
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = tokenRegex.exec(format)) !== null) {
    const name = match[1];
    if (requiredTokens.includes(name)) {
      tokensFound.add(name);
    } else {
      invalidTokens.push(name);
    }
    literals.push(format.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
  }
  literals.push(format.slice(lastIndex));

  const missing = requiredTokens.filter((t) => !tokensFound.has(t));
  if (missing.length) {
    return `Missing tokens: ${missing.map((t) => `{${t}}`).join(", ")}`;
  }
  if (invalidTokens.length) {
    return `Unknown tokens: ${invalidTokens.map((t) => `{${t}}`).join(", ")}`;
  }
  for (const lit of literals) {
    if (!FILENAME_LITERAL_REGEX.test(lit) || lit.includes("/") || lit.includes("\\")) {
      return "Contains invalid filename characters outside tokens.";
    }
  }
  return undefined;
}

function renderFilename(format: string, values: Record<string, string>): string {
  return Object.keys(values).reduce(
    (acc, key) => acc.replace(new RegExp(`\\{${key}\\}`, "g"), values[key]),
    format
  );
}

function getFilenameFormat(
  type: "contract" | "protocol",
  options?: { silent?: boolean }
): { format: string; error?: string } {
  const cfg = vscode.workspace.getConfiguration("specification");
  const raw =
    cfg.get<string>(type === "contract" ? "contractFilenameFormat" : "protocolFilenameFormat") ??
    (type === "contract" ? DEFAULT_CONTRACT_FILENAME_FORMAT : DEFAULT_PROTOCOL_FILENAME_FORMAT);
  const tokens = type === "contract" ? CONTRACT_FILENAME_TOKENS : PROTOCOL_FILENAME_TOKENS;
  const error = validateFilenameFormat(raw, tokens);
  if (error) {
    const msg = `Invalid ${type} filename format: ${error}`;
    if (options?.silent) {
      console.warn(msg);
    } else {
      void vscode.window.showWarningMessage(msg);
    }
  }
  return {
    format: error ? (type === "contract" ? DEFAULT_CONTRACT_FILENAME_FORMAT : DEFAULT_PROTOCOL_FILENAME_FORMAT) : raw,
    error,
  };
}

function buildFilenameFromClassification(type: "contract" | "protocol", classification: string, options?: { silent?: boolean }) {
  const parts = classification.slice(1).split("/");
  const isContract = type === "contract";
  const expected = isContract ? 5 : 4;
  if (parts.length !== expected || parts.some((p) => !p)) {
    return isContract ? "new-contract.cspec" : "new-protocol.pspec";
  }
  const values = isContract
    ? {
        layer: parts[0],
        verb: parts[1],
        subject: parts[2],
        variation: parts[3],
        platform: parts[4],
      }
    : {
        layer: parts[0],
        subject: parts[1],
        variation: parts[2],
        platform: parts[3],
      };
  const { format } = getFilenameFormat(type, options);
  const base = renderFilename(format, values);
  return `${base}${isContract ? DEFAULT_CONTRACT_FILE_EXTENSION : DEFAULT_PROTOCOL_FILE_EXTENSION}`;
}

export function activate(context: ExtensionContext) {
  console.debug("Activating 'emergent' language extension.");

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: "file", language: "emergent" }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
    },
    initializationOptions: {
      gateway: workspace.getConfiguration("gateway"),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient("emergent", "Emergent Coding", serverOptions, clientOptions);

  // Start the client. This will also launch the server
  console.debug("Starting 'emergent' language server.");

  client.start();

  // Completion and hover are now provided by the language server.
  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.showSpecificationPanel", () => {
      void showSpecificationPanel();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.reloadSpecifications", () => {
      void reloadValleySpecifications();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "emergent.openSpecificationAtPosition",
      (uri?: vscode.Uri | string, position?: vscode.Position | { line: number; character: number }) => {
        void showSpecificationPanel(uri, position);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "emergent.openLocalSpecificationAtPosition",
      (uri?: vscode.Uri | string, position?: vscode.Position | { line: number; character: number }) => {
        void openLocalSpecification(uri, position);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.newContractSpec", () => {
      void createNewContractSpec();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.clearSpecificationCache", async () => {
      try {
        const cachePath = await client.sendRequest<string>("emergent/getSpecCachePath", null);
        const choice = await vscode.window.showWarningMessage(
          `Clear the Emergent specification cache?\n${cachePath}`,
          { modal: true },
          "Clear"
        );
        if (choice === "Clear") {
          const cleared = await client.sendRequest<boolean>("emergent/clearSpecCache", null);
          if (cleared) {
            vscode.window.showInformationMessage("Emergent specification cache cleared.");
          } else {
            vscode.window.showErrorMessage("Failed to clear the Emergent specification cache.");
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to clear cache: ${err?.message ?? err}`);
      }
    })
  );

  // Code formatting implemented using API
  const emergentDocumentFormattingEditProvider = vscode.languages.registerDocumentFormattingEditProvider(
    "emergent",
    new EmergentDocumentFormatter()
  );
  const emergentDocumentRangeFormattingEditProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    "emergent",
    new EmergentDocumentRangeFormatter()
  );

  const ecStatusCommandId = "emergent.showFetchError";

  context.subscriptions.push(
    vscode.commands.registerCommand(ecStatusCommandId, () => {
      vscode.window.showInformationMessage(statusInfoMessage());
    })
  );

  // // ###
  // const tokenTypes = ["class", "interface", "enum", "function", "variable"];
  // const tokenModifiers = ["declaration", "documentation"];
  // const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

  // const provider: vscode.DocumentSemanticTokensProvider = {
  //   provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
  //     // analyze the document and return semantic tokens

  //     const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
  //     // on line 1, characters 1-5 are a class declaration
  //     tokensBuilder.push(new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 5)), "class", ["declaration"]);
  //     return tokensBuilder.build();
  //   },
  // };

  // const selector = { language: "java", scheme: "file" }; // register for all Java documents from the local file system

  // vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);

  // const emergentDocumentSemanticTokensProvider = vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);
  // context.subscriptions.push(emergentDocumentSemanticTokensProvider);
  // // ###

  ecStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  ecStatusBarItem.command = ecStatusCommandId;
  ecStatusBarItem.show();

  context.subscriptions.push(ecStatusBarItem);
  context.subscriptions.push(emergentDocumentFormattingEditProvider);
  context.subscriptions.push(emergentDocumentRangeFormattingEditProvider);

  registerSpecificationEditors(context);
  registerPdesVersionCheck(context);
  registerPdesEditor(context);
  registerExportProtocolSpec(context);

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("gateway")) {
      updateGatewayApiUrl();
      vscode.window.showInformationMessage("Updated");
    }
    if (e.affectsConfiguration("formatting")) {
      updateFormattingCfg();
    }
  });

  // Update Gateway API URL from configuration at start
  updateGatewayApiUrl();

  // Update formatting status from configuration
  updateFormattingCfg();

  validateFilenameFormats();

  // Init Valley state from context.
  try {
    updateStatusBar(ecStatusBarItem, v.init(context), false);
  } catch (error) {
    updateStatusBar(ecStatusBarItem, error.message, false);
  }

  // Start first Valley indexing

  setTimeout(() => {
    updateValleySpecs();
  }, 5000);

  // Schedule future indexing updates
  setInterval(async () => {
    updateValleySpecs();
  }, valleyScanIntervalMs);

  registerSpecificationLinks(context);
}

function updateValleySpecs() {
  v.updateSpecifications()
    .then((status) => {
      updateStatusBar(ecStatusBarItem, status, false);
    })
    .catch((error) => {
      updateStatusBar(ecStatusBarItem, error.message, false);
    });
}

async function reloadValleySpecifications() {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Reload Emergent specifications",
    },
    async (progress) => {
      progress.report({ message: "Fetching specifications from gateway..." });
      try {
        const status = await v.reloadSpecifications();
        updateStatusBar(ecStatusBarItem, status, false);
        vscode.window.showInformationMessage("Specification cache reloaded from gateway.");
      } catch (error: any) {
        const message = error?.message ?? String(error);
        updateStatusBar(ecStatusBarItem, message, true);
        vscode.window.showErrorMessage(`Failed to reload specifications: ${message}`);
      }
    }
  );
}

function updateGatewayApiUrl() {
  const gateway = vscode.workspace.getConfiguration("gateway");
  v.setApiRootUrl(gateway.hostname, gateway.port, gateway.allowInsecure);
  console.log("Gateway API URL updated:", v.apiRootUrl);
}

function updateFormattingCfg() {
  const formatting = vscode.workspace.getConfiguration("formatting");
  console.log("Formatting is now", formatting.disabled ? "disabled" : "enabled");
}

function validateFilenameFormats() {
  getFilenameFormat("contract", { silent: false });
  getFilenameFormat("protocol", { silent: false });
}

type FetchSpecificationResult = { classification: string; specification: any } | null;

async function showSpecificationPanel(
  uri?: vscode.Uri | string,
  position?: vscode.Position | { line: number; character: number }
) {
  if (!client) {
    vscode.window.showWarningMessage("Emergent language client is not ready yet.");
    return;
  }
  await client.onReady();
  const targetUri = typeof uri === "string" ? vscode.Uri.parse(uri) : uri;
  const editor = targetUri
    ? await vscode.workspace
        .openTextDocument(targetUri)
        .then((doc) => vscode.window.showTextDocument(doc, { preview: true }))
    : vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open an Emergent document to view a specification.");
    return;
  }

  const targetPosition =
    position instanceof vscode.Position
      ? position
      : position
      ? new vscode.Position(position.line, position.character)
      : editor.selection.active;

  const requestParams = {
    textDocument: { uri: editor.document.uri.toString() },
    position: targetPosition,
  };

  let result: FetchSpecificationResult;
  try {
    result = await client.sendRequest<FetchSpecificationResult>("emergent/fetchSpecification", requestParams);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to request specification: ${err?.message ?? err}`);
    return;
  }

  if (!result) {
    vscode.window.showInformationMessage("No specification found for the current line.");
    return;
  }

  if (specPanel) {
    specPanel.title = `Spec: ${result.classification}`;
  } else {
    specPanel = vscode.window.createWebviewPanel(
      "emergentSpecification",
      `Spec: ${result.classification}`,
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );
    specPanel.onDidDispose(() => {
      specPanel = undefined;
    });
  }

  specPanel.webview.html = renderSpecificationHtml(result.classification, result.specification);
}

function renderSpecificationHtml(classification: string, spec: any) {
  const specType = (spec?.type ?? "").toString();
  const isProtocol = specType === "protocol" || (!!spec?.host && !!spec?.join);
  const requirements = Array.isArray(spec?.requirements) ? spec.requirements : [];
  const obligations = Array.isArray(spec?.obligations) ? spec.obligations : [];
  const suppliers = Array.isArray(spec?.suppliers) ? spec.suppliers : [];
  const description = spec?.description ? String(spec.description) : "";

  const renderTerm = (t: { name: string; type: string; protocol?: string; hint?: string }) => {
    switch (t?.type) {
      case "abstraction":
        return `${t.name} :: ${t.protocol ?? ""}`;
      case "integer":
        return `${t.name} :: INTEGER${t.hint ? `[${t.hint}]` : ""}`;
      case "string":
        return `${t.name} :: STRING${t.hint ? `[${t.hint}]` : ""}`;
      case "boolean":
        return `${t.name} :: BOOLEAN`;
      default:
        return `${t?.name ?? ""}`;
    }
  };

  const listItems = (items: any[]) => items.map((i) => `<li>${renderTerm(i)}</li>`).join("");
  const renderRole = (label: string, role?: any) => {
    if (!role || (!Array.isArray(role.requirements) && !Array.isArray(role.obligations) && !role.macro)) {
      return "";
    }
    const reqs = Array.isArray(role.requirements) ? role.requirements : [];
    const oblgs = Array.isArray(role.obligations) ? role.obligations : [];
    const macro = role.macro ? String(role.macro) : "";
    return `
      <h2>${label}</h2>
      ${reqs.length ? `<h3>Requirements</h3><ul>${listItems(reqs)}</ul>` : ""}
      ${oblgs.length ? `<h3>Obligations</h3><ul>${listItems(oblgs)}</ul>` : ""}
      ${macro ? `<h3>Macro</h3><pre>${macro}</pre>` : ""}
    `;
  };

  const policyBlock =
    isProtocol && spec?.policy !== undefined ? `<p><strong>Policy:</strong> ${spec.policy}</p>` : "";
  const hostBlock = isProtocol ? renderRole("Host", spec?.host) : "";
  const joinBlock = isProtocol ? renderRole("Join", spec?.join) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-editor-font-family); padding: 12px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    h1 { font-size: 16px; margin-bottom: 8px; }
    h2 { font-size: 13px; margin: 12px 0 6px; border-bottom: 1px solid var(--vscode-editorWidget-border); padding-bottom: 4px; }
    p { margin: 6px 0; }
    ul { padding-left: 18px; }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <h1>${classification}</h1>
  ${description ? `<p>${description}</p>` : ""}
  ${policyBlock}
  ${hostBlock}
  ${joinBlock}
  ${
    requirements.length
      ? `<h2>Requirements</h2><ul>${listItems(requirements)}</ul>`
      : ""
  }
  ${
    obligations.length
      ? `<h2>Obligations</h2><ul>${listItems(obligations)}</ul>`
      : ""
  }
  ${
    suppliers.length ? `<h2>Suppliers</h2><p>${suppliers.join(", ")}</p>` : ""
  }
</body>
</html>`;
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }

  console.debug("Dectivating 'emergent' language extension.");
  return client.stop();
}

// const contractSpecs = [
// 	{ layer: "data", verb: "add", subject: "integer", variation: "default", platform: "x64", supplier: "aptissio" },
// 	{ layer: "data", verb: "new", subject: "program", variation: "default", platform: "linux-x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64", supplier: "codevalley" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "reserve", platform: "x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "reserve", platform: "linux-x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "linux-x64", supplier: "codevalley" },
// 	{ layer: "system", verb: "register", subject: "app-flow", variation: "default", platform: "x64", supplier: "codevalley" },
// 	{ layer: "behaviour", verb: "new", subject: "agent-bitcoin-wallet", variation: "default", platform: "linux-x64", supplier: "aptissio" },
// 	{ layer: "data", verb: "new", subject: "bytesequence", variation: "default", platform: "x64", supplier: "codevalley" },
// ];

function updateStatusBar(statusBar: vscode.StatusBarItem, status: string, error = false) {
  if (error) {
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  } else {
    statusBar.backgroundColor = undefined;
  }
  // statusBar.text = `$(debug-disconnect) Gateway down`;
  // statusBar.text = `$(pass) Gateway OK`;
  statusBar.text = status;
  lastStatusText = status;
}

function statusInfoMessage() {
  return lastStatusText;
}

function registerSpecificationEditors(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection("spec-schema");
  context.subscriptions.push(diagnostics);

  const contractSchema = loadSchema(context, "contractSpec.schema.json");
  const protocolSchema = loadSchema(context, "protocolSpec.schema.json");

  const options = {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  };

  if (contractSchema) {
    const contractProvider = new SpecEditorProvider(context, contractSchema, diagnostics, "supplier");
    context.subscriptions.push(vscode.window.registerCustomEditorProvider("contractSpecEditor", contractProvider, options));
  }

  if (protocolSchema) {
    const protocolProvider = new SpecEditorProvider(context, protocolSchema, diagnostics, "protocol");
    context.subscriptions.push(vscode.window.registerCustomEditorProvider("protocolSpecEditor", protocolProvider, options));
  }

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.fsPath.toLowerCase().endsWith(".pspec") || doc.uri.fsPath.toLowerCase().endsWith(".cspec")) {
        diagnostics.delete(doc.uri);
      }
    })
  );
}

function registerPdesEditor(context: vscode.ExtensionContext) {
  const schema = loadPdesSchema(context);
  if (!schema) {
    return;
  }

  const diagnostics = vscode.languages.createDiagnosticCollection("pdes-schema");
  context.subscriptions.push(diagnostics);

  let provider: PdesEditorProvider;
  try {
    provider = new PdesEditorProvider(context, schema, diagnostics);
  } catch (err: any) {
    console.error("Failed to initialize Protocol Design Editor", err);
    void vscode.window.showErrorMessage(
      `Failed to initialize Protocol Design Editor: ${err?.message ?? String(err)}`
    );
    return;
  }
  const options = {
    webviewOptions: { retainContextWhenHidden: true },
    supportsMultipleEditorsPerDocument: true,
  };
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("protocolDesignEditor", provider, options)
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.fsPath.toLowerCase().endsWith(".pdes")) {
        diagnostics.delete(doc.uri);
      }
    })
  );
}

function getDefaultsFromText(text: string) {
  const defaults = text.match(
    /(^|\n)\s*defaults:\s+(?<layer>[^ ,]*)\s*,\s*(?<variation>[^ ,]*)\s*,\s*(?<platform>[^ ,]*)\s*,\s*(?<supplier>\w*)/
  );
  return defaults ? (defaults.groups as any) : null;
}

type ClassificationInfo =
  | { type: "contract"; classification: string; position: vscode.Position }
  | { type: "protocol"; classification: string; position: vscode.Position };

function getClassificationAtPosition(document: vscode.TextDocument, position: vscode.Position): ClassificationInfo | null {
  const defaults = getDefaultsFromText(document.getText()) || { layer: "", variation: "", platform: "", supplier: "" };
  const lineText = document.lineAt(position.line).text;

  const contractPattern =
    /(sub|job)\s+(?<raw>(?:\/(?<layer>[^/]*)\/?)?(?<verb>[^/]*)?\/?(?<subject>[^/@(]*)?\/?(?<variation>[^/@(]*)?\/?(?<platform>[^/@(]*))/;
  const protocolPattern =
    /(host|join)\s+(?<raw>(?:\/(?<layer>[^/]*)\/?)?(?<subject>[^/@(]*)?\/?(?<variation>[^/@(]*)?\/?(?<platform>[^/@(]*))/;

  const matchAt = (pattern: RegExp) => {
    const m = pattern.exec(lineText);
    if (!m || !m.groups?.raw) return null;
    const raw = m.groups.raw;
    const startCol = m.index + m[0].indexOf(raw);
    const endCol = startCol + raw.length;
    if (position.character < startCol || position.character > endCol) {
      return null;
    }
    return { match: m.groups, start: startCol, end: endCol };
  };

  const contract = matchAt(contractPattern);
  if (contract) {
    const layer = contract.match.layer && contract.match.layer !== "." ? contract.match.layer : defaults.layer;
    const verb = contract.match.verb;
    const subject = contract.match.subject;
    const variation = contract.match.variation && contract.match.variation !== "." ? contract.match.variation : defaults.variation;
    const platform = contract.match.platform && contract.match.platform !== "." ? contract.match.platform : defaults.platform;
    if (layer && verb && subject && variation && platform) {
      return {
        type: "contract",
        classification: `/${layer}/${verb}/${subject}/${variation}/${platform}`,
        position: new vscode.Position(position.line, contract.start),
      };
    }
  }

  const protocol = matchAt(protocolPattern);
  if (protocol) {
    const layer = protocol.match.layer && protocol.match.layer !== "." ? protocol.match.layer : defaults.layer;
    const subject = protocol.match.subject;
    const variation =
      protocol.match.variation && protocol.match.variation !== "." ? protocol.match.variation : defaults.variation;
    const platform = protocol.match.platform && protocol.match.platform !== "." ? protocol.match.platform : defaults.platform;
    if (layer && subject && variation && platform) {
      return {
        type: "protocol",
        classification: `/${layer}/${subject}/${variation}/${platform}`,
        position: new vscode.Position(position.line, protocol.start),
      };
    }
  }

  return null;
}

function registerSpecificationLinks(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = { language: "emergent", scheme: "file" };
  const provider: vscode.DocumentLinkProvider = {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
      const links: vscode.DocumentLink[] = [];
      const contractPattern =
        /(sub|job)\s+(?<raw>(?:\/(?<layer>[^/]*)\/?)?(?<verb>[^/]*)?\/?(?<subject>[^/@(]*)?\/?(?<variation>[^/@(]*)?\/?(?<platform>[^/@(]*))/g;
      const protocolPattern =
        /(host|join)\s+(?<raw>(?:\/(?<layer>[^/]*)\/?)?(?<subject>[^/@(]*)?\/?(?<variation>[^/@(]*)?\/?(?<platform>[^/@(]*))/g;
      const defaults = getDefaultsFromText(document.getText()) || { layer: "", variation: "", platform: "", supplier: "" };

      for (let line = 0; line < document.lineCount; line++) {
        const textLine = document.lineAt(line);
        const processMatch = (match: RegExpExecArray | null, type: "contract" | "protocol") => {
          if (!match) {
            return;
          }
          const groups = match.groups ?? {};
          const layer = groups.layer && groups.layer !== "." ? groups.layer : defaults.layer;
          const subject = groups.subject;
          const variation = groups.variation && groups.variation !== "." ? groups.variation : defaults.variation;
          const platform = groups.platform && groups.platform !== "." ? groups.platform : defaults.platform;
          const verb = type === "contract" ? groups.verb : undefined;

          if (type === "contract" && (!layer || !verb || !subject || !variation || !platform)) {
            return;
          }
          if (type === "protocol" && (!layer || !subject || !variation || !platform)) {
            return;
          }

          const raw = groups.raw ?? "";
          if (!raw) {
            return;
          }
          const classification =
            type === "contract"
              ? `/${layer}/${verb}/${subject}/${variation}/${platform}`
              : `/${layer}/${subject}/${variation}/${platform}`;
          const classificationIndex = match.index + match[0].indexOf(raw);
          const start = new vscode.Position(line, classificationIndex);
          const end = new vscode.Position(line, classificationIndex + raw.length);
          const args = [document.uri.toString(), { line, character: classificationIndex }];
          const remoteUri = vscode.Uri.parse(
            `command:emergent.openSpecificationAtPosition?${encodeURIComponent(JSON.stringify(args))}`
          );
          const localUri = vscode.Uri.parse(
            `command:emergent.openLocalSpecificationAtPosition?${encodeURIComponent(JSON.stringify(args))}`
          );
          const range = new vscode.Range(start, end);

          const remoteLink = new vscode.DocumentLink(range, remoteUri);
          remoteLink.tooltip = "Show specification";
          links.push(remoteLink);

          const localLink = new vscode.DocumentLink(range, localUri);
          localLink.tooltip = "Open local specification (Ctrl+Shift+Click)";
          links.push(localLink);
        };

        let match: RegExpExecArray | null;
        while ((match = contractPattern.exec(textLine.text)) !== null) {
          processMatch(match, "contract");
        }
        while ((match = protocolPattern.exec(textLine.text)) !== null) {
          processMatch(match, "protocol");
        }
      }

      return links;
    },
  };

  context.subscriptions.push(vscode.languages.registerDocumentLinkProvider(selector, provider));
}

async function createNewContractSpec() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    void vscode.window.showWarningMessage("Open a workspace folder to create a contract specification.");
    return;
  }

  const classification = await vscode.window.showInputBox({
    title: "Contract Classification",
    prompt: "Enter contract classification (/layer/verb/subject/variation/platform)",
    value: "/layer/verb/subject/variation/platform",
    validateInput: (value) => {
      const trimmed = value.trim();
      return CONTRACT_CLASSIFICATION_PATTERN.test(trimmed)
        ? undefined
        : "Classification must match /layer/verb/subject/variation/platform (lowercase, digits, hyphens).";
    },
  });

  if (!classification) {
    return;
  }

  const trimmedClassification = classification.trim();
  const defaultSupplier = vscode.workspace.getConfiguration("specification").get<string>("defaultSupplier", "") ?? "";

  const suggestedFilename = buildFilenameFromClassification("contract", trimmedClassification, { silent: false });

  const defaultUri = vscode.Uri.joinPath(workspaceFolder.uri, suggestedFilename);
  const targetUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "Contract Specification": ["cspec"] },
    saveLabel: "Create Contract Specification",
  });

  if (!targetUri) {
    return;
  }

  const template = {
    type: "supplier",
    name: trimmedClassification,
    description: "",
    requirements: [],
    obligations: [],
    supplier: defaultSupplier,
  };

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(template, null, 2) + "\n");
    await vscode.workspace.fs.writeFile(targetUri, data);
    // Ensure VS Code loads the freshly written document before opening the custom editor.
    await vscode.workspace.openTextDocument(targetUri);
    await vscode.commands.executeCommand("vscode.openWith", targetUri, "contractSpecEditor");
  } catch (error: any) {
    console.error("Failed to create contract specification", error);
    void vscode.window.showErrorMessage(`Failed to create contract specification: ${error?.message ?? error}`);
  }
}

async function openLocalSpecification(uri?: vscode.Uri | string, position?: vscode.Position | { line: number; character: number }) {
  const targetUri = typeof uri === "string" ? vscode.Uri.parse(uri) : uri;
  const editor =
    targetUri !== undefined
      ? await vscode.workspace.openTextDocument(targetUri).then((doc) => vscode.window.showTextDocument(doc, { preview: true }))
      : vscode.window.activeTextEditor;
  const targetPosition =
    position instanceof vscode.Position
      ? position
      : position
      ? new vscode.Position(position.line, position.character)
      : editor?.selection.active;

  if (!editor || !targetPosition) {
    return;
  }

  const info = getClassificationAtPosition(editor.document, targetPosition);
  if (!info) {
    return;
  }

  const config = vscode.workspace.getConfiguration("specification");
  const contractRoot = config.get<string>("localContractRoot", "") ?? "";
  const protocolRoot = config.get<string>("localProtocolRoot", "") ?? "";

  const rootString = info.type === "contract" ? contractRoot : protocolRoot;
  if (!rootString) {
    return;
  }

  let rootUri: vscode.Uri | null = null;
  try {
    rootUri = rootString.startsWith("file:") ? vscode.Uri.parse(rootString) : vscode.Uri.file(rootString);
  } catch {
    rootUri = null;
  }
  if (!rootUri) {
    void vscode.window.showWarningMessage("Invalid local specification root path.");
    return;
  }

  const suggestedName = buildFilenameFromClassification(info.type, info.classification, { silent: true });
  const pattern = new vscode.RelativePattern(rootUri, `**/${suggestedName}`);
  const matches = await vscode.workspace.findFiles(pattern);

  let specFile: vscode.Uri | undefined;

  if (matches.length === 1) {
    specFile = matches[0];
  } else if (matches.length > 1) {
    const selection = await vscode.window.showQuickPick(
      matches.map((m) => ({ label: vscode.workspace.asRelativePath(m, false), uri: m })),
      { title: "Select specification to open" }
    );
    specFile = selection?.uri;
  } else {
    const create = await vscode.window.showInformationMessage(
      `No local ${info.type === "contract" ? "contract" : "protocol"} specification found. Create it?`,
      { modal: false },
      "Create"
    );
    if (create === "Create") {
      specFile = vscode.Uri.joinPath(rootUri, suggestedName);
      const template =
        info.type === "contract"
          ? {
              type: "supplier",
              name: info.classification,
              description: "",
              requirements: [],
              obligations: [],
              supplier: config.get<string>("defaultSupplier", "") ?? "",
            }
          : {
              type: "protocol",
              policy: 0,
              name: info.classification,
              description: "",
              host: { requirements: [], obligations: [], macro: "" },
              join: { requirements: [], obligations: [], macro: "" },
            };
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(template, null, 2) + "\n");
      await vscode.workspace.fs.writeFile(specFile, data);
    }
  }

  if (!specFile) {
    return;
  }

  const viewType = info.type === "contract" ? "contractSpecEditor" : "protocolSpecEditor";
  await vscode.commands.executeCommand("vscode.openWith", specFile, viewType);
}
