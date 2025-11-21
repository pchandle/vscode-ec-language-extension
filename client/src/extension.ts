/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { Valley } from "./valley";
import { EmergentDocumentFormatter, EmergentDocumentRangeFormatter } from "./formatting";
import { workspace, ExtensionContext } from "vscode";

import * as vscode from "vscode";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

let client: LanguageClient;
let ecStatusBarItem: vscode.StatusBarItem;

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

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }

  console.debug("Dectivating 'emergent' language extension.");
  return client.stop();
}

import { connected } from "process";

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
