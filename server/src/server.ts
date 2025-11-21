/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	Hover,
	MarkupKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { buildCompletionItems, getDefaultsFromText } from './completionSupport';
import { gatewayClient } from './gatewayClient';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let gatewayConfig: { hostname: string; port: number; allowInsecure: boolean } = {
	hostname: 'localhost',
	port: 10000,
	allowInsecure: true
};


connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;
	gatewayClient.setConfig(gatewayConfig);
	if (params.initializationOptions && params.initializationOptions.gateway) {
		gatewayConfig = params.initializationOptions.gateway;
		gatewayClient.setConfig(gatewayConfig);
	}

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			},
			hoverProvider: true
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}

	gatewayClient.attachConnection(connection);
	void gatewayClient.refreshContractCache();
	gatewayClient.startCacheTimer();
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface EmergentSettings {
	maxNumberOfProblems: number;
	hoverDebugLogging: boolean;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: EmergentSettings = { maxNumberOfProblems: 1000, hoverDebugLogging: false };
let globalSettings: EmergentSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<EmergentSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <EmergentSettings>(
			(change.settings.emergent || defaultSettings)
		);
	}

	// Revalidate all open text documents
	// documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<EmergentSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'emergent'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	// validateTextDocument(change.document);
});

// async function validateTextDocument(textDocument: TextDocument): Promise<void> {
// 	// In this simple example we get the settings for every validate run.
// 	const settings = await getDocumentSettings(textDocument.uri);

// 	// The validator creates diagnostics for all uppercase words length 2 and more
// 	const text = textDocument.getText();
// 	const pattern = /\b[A-Z]{2,}\b/g;
// 	let m: RegExpExecArray | null;

// 	let problems = 0;
// 	const diagnostics: Diagnostic[] = [];
// 	while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
// 		problems++;
// 		const diagnostic: Diagnostic = {
// 			severity: DiagnosticSeverity.Warning,
// 			range: {
// 				start: textDocument.positionAt(m.index),
// 				end: textDocument.positionAt(m.index + m[0].length)
// 			},
// 			message: `${m[0]} is all uppercase.`,
// 			source: 'ex'
// 		};
// 		if (hasDiagnosticRelatedInformationCapability) {
// 			diagnostic.relatedInformation = [
// 				{
// 					location: {
// 						uri: textDocument.uri,
// 						range: Object.assign({}, diagnostic.range)
// 					},
// 					message: 'Spelling matters'
// 				},
// 				{
// 					location: {
// 						uri: textDocument.uri,
// 						range: Object.assign({}, diagnostic.range)
// 					},
// 					message: 'Particularly for names'
// 				}
// 			];
// 		}
// 		diagnostics.push(diagnostic);
// 	}

// 	// Send the computed diagnostics to VSCode.
// 	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
// }

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

connection.onHover(async (params): Promise<Hover | null> => {
	const settings = await getDocumentSettings(params.textDocument.uri);
	const hoverDebugLogging = settings.hoverDebugLogging;
	const debugLog = (message: string) => {
		if (hoverDebugLogging) {
			connection.console.log(message);
		}
	};

	const document = documents.get(params.textDocument.uri);
	if (!document) {
		connection.console.warn(`Hover: document not found for ${params.textDocument.uri}`);
		return null;
	}

	const lineRange = {
		start: { line: params.position.line, character: 0 },
		end: { line: params.position.line + 1, character: 0 }
	};

	const lineText = document.getText(lineRange);
	debugLog(`Hover: raw line text "${lineText.trim()}" at ${params.position.line}:${params.position.character}`);
	const matches =
		lineText.match(
			/.*(sub|job)\s+(?:\/(?<layer>[^/]*)\/?)?(?<verb>[^/]*)?\/?(?<subject>[^/@(]*)?\/?(?<variation>[^/@(]*)?\/?(?<platform>[^/@(]*)?@?(?<supplier>[^(]*)?/
		)?.groups || {};

	const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };
	debugLog(
		`Hover: defaults layer=${defaults.layer}, variation=${defaults.variation}, platform=${defaults.platform}, supplier=${defaults.supplier}`
	);

	const layer = matches.layer && matches.layer !== '.' ? matches.layer : defaults.layer;
	const verb = matches.verb;
	const subject = matches.subject;
	const variation = matches.variation && matches.variation !== '.' ? matches.variation : defaults.variation;
	const platform = matches.platform && matches.platform !== '.' ? matches.platform : defaults.platform;

	if (!layer || !verb || !subject || !variation || !platform) {
		debugLog(
			`Hover: incomplete classification (layer=${layer}, verb=${verb}, subject=${subject}, variation=${variation}, platform=${platform})`
		);
		return null;
	}

	const classification = `/${layer}/${verb}/${subject}/${variation}/${platform}`;
	debugLog(`Hover: classification ${classification}, supplier=${matches.supplier ?? ''}`);
	const spec = await gatewayClient.fetchContractSpec(classification);
	if (!spec) {
		debugLog(`Hover: no spec returned for ${classification}`);
		return null;
	}
	debugLog(`Hover: rendering hover for ${classification}`);

	const lines: string[] = [];
	if (spec.description) {
		lines.push(`**Description**\n\n${spec.description}`);
	}

	const renderTerm = (t: { name: string; type: string; protocol?: string; hint?: string; length?: number; minimum?: number; maximum?: number }) => {
		switch (t.type) {
			case 'abstraction':
				return `${t.name} :: ${t.protocol ?? ''}`;
			case 'integer':
				return `${t.name} :: INTEGER${t.hint ? `[${t.hint}]` : ''}`;
			case 'string':
				return `${t.name} :: STRING${t.hint ? `[${t.hint}]` : ''}`;
			case 'boolean':
				return `${t.name} :: BOOLEAN`;
			default:
				return `${t.name}`;
		}
	};

	if (spec.requirements && spec.requirements.length > 0) {
		lines.push('**Requirements**', ...spec.requirements.map(req => `- ${renderTerm(req)}`));
	}
	if (spec.obligations && spec.obligations.length > 0) {
		lines.push('**Obligations**', ...spec.obligations.map(ob => `- ${renderTerm(ob)}`));
	}
	if (spec.suppliers && spec.suppliers.length > 0) {
		lines.push(`**Suppliers**\n\n${spec.suppliers.join(', ')}`);
	}

	return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n\n') } };
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(params: TextDocumentPositionParams): CompletionItem[] => {
		const document = documents.get(params.textDocument.uri);
		if (!document) {
			return [];
		}
		return buildCompletionItems(gatewayClient.completionCache, document, params.position);
	}
);

connection.onShutdown(() => {
	gatewayClient.dispose();
});

connection.onExit(() => {
	gatewayClient.dispose();
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
