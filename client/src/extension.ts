/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { Valley } from "./valley";
import { SpecEditorProvider, loadSchema } from "./customEditors/SpecEditorProvider";
import { EmergentDocumentFormatter, EmergentDocumentRangeFormatter } from "./formatting";
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
    vscode.commands.registerCommand(
      "emergent.openSpecificationAtPosition",
      (uri?: vscode.Uri | string, position?: vscode.Position | { line: number; character: number }) => {
        void showSpecificationPanel(uri, position);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.newContractSpec", () => {
      void createNewContractSpec();
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

function updateGatewayApiUrl() {
  const gateway = vscode.workspace.getConfiguration("gateway");
  v.setApiRootUrl(gateway.hostname, gateway.port, gateway.allowInsecure);
  console.log("Gateway API URL updated:", v.apiRootUrl);
}

function updateFormattingCfg() {
  const formatting = vscode.workspace.getConfiguration("formatting");
  console.log("Formatting is now", formatting.disabled ? "disabled" : "enabled");
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
}

function getDefaultsFromText(text: string) {
  const defaults = text.match(
    /(^|\n)\s*defaults:\s+(?<layer>[^ ,]*)\s*,\s*(?<variation>[^ ,]*)\s*,\s*(?<platform>[^ ,]*)\s*,\s*(?<supplier>\w*)/
  );
  return defaults ? (defaults.groups as any) : null;
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
          const commandUri = vscode.Uri.parse(
            `command:emergent.openSpecificationAtPosition?${encodeURIComponent(JSON.stringify(args))}`
          );
          const link = new vscode.DocumentLink(new vscode.Range(start, end), commandUri);
          link.tooltip = "Show specification";
          links.push(link);
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

  const classificationPattern = /^\/(?:[a-z0-9-]+\/){4}[a-z0-9-]+$/;
  const classification = await vscode.window.showInputBox({
    title: "Contract Classification",
    prompt: "Enter contract classification (/layer/verb/subject/variation/platform)",
    value: "/layer/verb/subject/variation/platform",
    validateInput: (value) => {
      const trimmed = value.trim();
      return classificationPattern.test(trimmed)
        ? undefined
        : "Classification must match /layer/verb/subject/variation/platform (lowercase, digits, hyphens).";
    },
  });

  if (!classification) {
    return;
  }

  const trimmedClassification = classification.trim();
  const defaultSupplier = vscode.workspace.getConfiguration("specification").get<string>("defaultSupplier", "") ?? "";

  const suggestedFilename = (() => {
    const parts = trimmedClassification.slice(1).split("/");
    return parts.length === 5 && parts.every((p) => p) ? `${parts.join("--")}.cspec` : "new-contract.cspec";
  })();

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

  const data = Buffer.from(JSON.stringify(template, null, 2) + "\n", "utf8");

  try {
    await vscode.workspace.fs.writeFile(targetUri, data);
    await vscode.commands.executeCommand("vscode.openWith", targetUri, "contractSpecEditor");
  } catch (error: any) {
    console.error("Failed to create contract specification", error);
    void vscode.window.showErrorMessage(`Failed to create contract specification: ${error?.message ?? error}`);
  }
}
