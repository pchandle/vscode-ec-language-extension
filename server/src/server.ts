/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	Hover,
	MarkupKind,
	TextDocumentPositionParams,
	RequestType,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';
import { performance } from 'perf_hooks';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import {
	buildCompletionItems,
	buildContractSpecCompletionItems,
	buildProtocolSpecCompletionItems,
	getDefaultsFromText,
	shouldTriggerContractSpecCompletion,
	shouldTriggerProtocolSpecCompletion
} from './completionSupport';
import { gatewayClient, RemoteContractSpec } from './gatewayClient';
import { collectDiagnostics } from './diagnostics';
import { getTypeHoverMarkdown } from './typeHover';
import { parseText } from './lang/parser';
import { ProgramNode, Statement } from './lang/ast';

type FetchSpecificationParams = { textDocument: { uri: string }; position: { line: number; character: number } };
type FetchSpecificationResult = { classification: string; specification: any } | null;

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let gatewayConfig: { hostname: string; port: number; allowInsecure: boolean; network: string } = {
	hostname: 'localhost',
	port: 10000,
	allowInsecure: true,
	network: '31'
};

type TraceLevel = 'off' | 'messages' | 'verbose';
const validationDebounceMs = 200;
const pendingValidation: Map<string, NodeJS.Timeout> = new Map();

function logTrace(level: TraceLevel | undefined, message: string, data?: Record<string, string | number | boolean | null>) {
	if (!level || level === 'off') {
		return;
	}
	const suffix = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
	connection.console.log(`[trace] ${message}${suffix}`);
}

function traceDuration(level: TraceLevel | undefined, operation: string, started: number, data?: Record<string, string | number | boolean | null>) {
	logTrace(level, `${operation} ${Math.round(performance.now() - started)}ms`, data);
}


connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;
	gatewayClient.setConfig(gatewayConfig);
	if (params.initializationOptions && params.initializationOptions.gateway) {
		gatewayConfig = params.initializationOptions.gateway;
		gatewayClient.setConfig(gatewayConfig);
	}
	gatewayClient.setNetworkPaths(gatewayConfig.network);

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
	gatewayNetwork: string;
	hoverDisabled?: boolean;
	hover?: { disabled?: boolean };
	traceServer?: TraceLevel;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: EmergentSettings = {
	maxNumberOfProblems: 100,
	hoverDebugLogging: false,
	gatewayNetwork: '31',
	hoverDisabled: true,
	traceServer: 'off'
};
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

	if (change.settings?.gateway?.network && typeof change.settings.gateway.network === 'string') {
		gatewayConfig.network = change.settings.gateway.network;
		gatewayClient.setNetworkPaths(gatewayConfig.network);
	}

	// Revalidate all open text documents
	documents.all().forEach(scheduleValidation);
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

function clearScheduledValidation(uri: string) {
	const handle = pendingValidation.get(uri);
	if (handle) {
		clearTimeout(handle);
		pendingValidation.delete(uri);
	}
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	const settings = await getDocumentSettings(textDocument.uri);
	const traceLevel = settings.traceServer ?? 'off';
	const started = performance.now();
	const defaults = getDefaultsFromText(textDocument.getText()) || { layer: '', variation: '', platform: '', supplier: '' };

	// Collect contract specifications referenced in the document so that diagnostics can validate
	// requirements/obligations.
	const { program } = parseText(textDocument.getText());
	const classifications = new Set<string>();
	const rawToNormalized = new Map<string, string>();
	const collect = (stmts: Statement[]) => {
		for (const stmt of stmts) {
			const cls = (stmt as any).classification?.lexeme;
			if (cls) {
				const normalized = normalizeClassification(cls, defaults);
				if (normalized) {
					classifications.add(normalized);
					rawToNormalized.set(cls, normalized);
				}
			}
			if ((stmt as any).body?.statements) {
				collect((stmt as any).body.statements);
			}
			if ((stmt as any).block?.statements) {
				collect((stmt as any).block.statements);
			}
		}
	};
	collect((program as ProgramNode).statements);

	const contractSpecs: Record<string, RemoteContractSpec> = {};
	for (const cls of classifications) {
		try {
			const spec = await gatewayClient.fetchContractSpec(cls);
			if (spec) {
				contractSpecs[cls] = spec;
				for (const [raw, norm] of rawToNormalized.entries()) {
					if (norm === cls && raw !== cls) {
						contractSpecs[raw] = spec;
					}
				}
			}
		} catch (err: any) {
			connection.console.warn(`Diagnostics: failed to fetch spec ${cls}: ${err?.message ?? err}`);
		}
	}

	const diagnostics = collectDiagnostics(
		textDocument,
		{
			maxNumberOfProblems: settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems
		},
		contractSpecs,
		defaults
	);

	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	traceDuration(traceLevel, 'diagnostics', started, { uri: textDocument.uri });
}

function scheduleValidation(textDocument: TextDocument): void {
	clearScheduledValidation(textDocument.uri);
	const handle = setTimeout(() => {
		pendingValidation.delete(textDocument.uri);
		void validateTextDocument(textDocument);
	}, validationDebounceMs);
	pendingValidation.set(textDocument.uri, handle);
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
	clearScheduledValidation(e.document.uri);
	connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// Rebuild (validate) on open/change with a deterministic debounce.
documents.onDidOpen(event => {
	scheduleValidation(event.document);
});
documents.onDidChangeContent(change => {
	scheduleValidation(change.document);
});

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

const fetchSpecificationRequest = new RequestType<FetchSpecificationParams, FetchSpecificationResult, void>('emergent/fetchSpecification');
const clearSpecCacheRequest = new RequestType<null, boolean, void>('emergent/clearSpecCache');
const getSpecCachePathRequest = new RequestType<null, string, void>('emergent/getSpecCachePath');

type ContractTerm = { name?: string; type: string; protocol?: string; hint?: string; length?: number; minimum?: number; maximum?: number };

const MARKDOWN_STYLES = {
	heading: '#5E994F',
	keyword: '#c586c0',
	classification: '#2e74a6',
	abstraction: '#f27b39',
	primitive: '#cb3697'
};

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTermRow(term: ContractTerm): string {
	const name = escapeHtml(term?.name ?? '');
	let typeMarkup: string;
	switch (term?.type) {
		case 'abstraction': {
			const protocolText = term.protocol ? escapeHtml(term.protocol) : '';
			typeMarkup = `<span style="color:${MARKDOWN_STYLES.abstraction};">${protocolText}</span>`;
			break;
		}
		case 'integer': {
			const hint = term.hint ? `[${escapeHtml(String(term.hint))}]` : '';
			typeMarkup = `<span style="color:${MARKDOWN_STYLES.primitive};">INTEGER${hint}</span>`;
			break;
		}
		case 'string': {
			const hint = term.hint ? `[${escapeHtml(String(term.hint))}]` : '';
			typeMarkup = `<span style="color:${MARKDOWN_STYLES.primitive};">STRING${hint}</span>`;
			break;
		}
		case 'boolean':
			typeMarkup = `<span style="color:${MARKDOWN_STYLES.primitive};">BOOLEAN</span>`;
			break;
		default:
			typeMarkup = escapeHtml(term?.type ?? '');
	}
	return `<tr><td>${name}</td><td>::${typeMarkup}</td></tr>`;
}

function renderStyledHover(spec: RemoteContractSpec, classification: string): string {
	const parts: string[] = [];
	const safeDescription = spec.description ? escapeHtml(String(spec.description)) : '';
	const safeName = escapeHtml(spec.name || classification);
	const requirements = Array.isArray(spec.requirements) ? spec.requirements.map(renderTermRow).join('') : '';
	const obligations = Array.isArray(spec.obligations) ? spec.obligations.map(renderTermRow).join('') : '';

	if (safeDescription) {
		parts.push(
			`<span style="color:${MARKDOWN_STYLES.heading};"><em>Description</em></span><br>${safeDescription}<br>`
		);
	}

	const interfaceSections: string[] = [];
	interfaceSections.push(`<span style="color:${MARKDOWN_STYLES.heading};"><em>Interface</em></span><br>`);
	interfaceSections.push(
		`<span style="color:${MARKDOWN_STYLES.keyword};">sub</span> <span style="color:${MARKDOWN_STYLES.classification};">${safeName}</span>(<br>`
	);
	if (requirements) {
		interfaceSections.push('<table>', requirements, '</table>');
	}
	interfaceSections.push(') -&gt;<br>');
	if (obligations) {
		interfaceSections.push('<table>', obligations, '</table>');
	}
	parts.push(interfaceSections.join(''));

	if (Array.isArray(spec.suppliers) && spec.suppliers.length > 0) {
		parts.push(
			`<span style="color:${MARKDOWN_STYLES.heading};"><em>Suppliers</em></span><br>${spec.suppliers
				.map(s => escapeHtml(String(s)))
				.join(', ')}`
		);
	}

	return parts.join('\n\n');
}

function normalizeClassification(raw: string, defaults: { layer: string; variation: string; platform: string }) {
	const withoutSupplier = raw.split('@')[0] ?? raw;
	const beforeParen = withoutSupplier.split('(')[0] ?? withoutSupplier;
	const cleaned = beforeParen.trim().replace(/^\/+/, '');
	const segments = cleaned.split('/').filter(s => s.length > 0);
	const applyDefault = (seg: string | undefined, fallback: string) => (!seg || seg === '.' ? fallback : seg);

	let layer = applyDefault(defaults.layer, defaults.layer);
	let verb = '';
	let subject = '';
	let variation = applyDefault(defaults.variation, defaults.variation);
	let platform = applyDefault(defaults.platform, defaults.platform);

	if (segments.length >= 5) {
		[layer, verb, subject, variation, platform] = segments;
	} else if (segments.length === 4) {
		[verb, subject, variation, platform] = segments;
	} else if (segments.length === 3) {
		[verb, subject, variation] = segments;
	} else if (segments.length === 2) {
		[verb, subject] = segments;
	} else if (segments.length === 1) {
		verb = segments[0];
	}

	layer = applyDefault(layer, defaults.layer);
	verb = applyDefault(verb, '');
	subject = applyDefault(subject, '');
	variation = applyDefault(variation, defaults.variation);
	platform = applyDefault(platform, defaults.platform);

	if (layer && verb && subject && variation && platform) {
		return `/${layer}/${verb}/${subject}/${variation}/${platform}`;
	}
	return null;
}

function rangeContainsPosition(range: { start: { line: number; character: number }; end: { line: number; character: number } }, position: { line: number; character: number }) {
	if (position.line < range.start.line || position.line > range.end.line) return false;
	if (position.line === range.start.line && position.character < range.start.character) return false;
	if (position.line === range.end.line && position.character > range.end.character) return false;
	return true;
}

function getAstClassification(document: TextDocument, params: TextDocumentPositionParams): { classification: string; supplier: string } | null {
	try {
		const { program } = parseText(document.getText());
		const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };

		const findStmt = (
			statements: Statement[],
			inheritedClassification?: { lexeme: string }
		): { stmt: Statement; classification?: { lexeme: string } } | null => {
			for (const stmt of statements) {
				if (!rangeContainsPosition(stmt.range, params.position)) continue;

				const currentClassification = (stmt as any)?.classification ?? inheritedClassification;

				// Recurse into inner statements first for most specific match.
				const jobBody = (stmt as any).body;
				if (jobBody?.statements) {
					const inner = findStmt(jobBody.statements, currentClassification);
					if (inner) return inner;
				}
				const block = (stmt as any).block;
				if (block?.statements) {
					const inner = findStmt(block.statements, currentClassification);
					if (inner) return inner;
				}
				return { stmt, classification: currentClassification };
			}
			return null;
		};

		const result = findStmt((program as unknown as ProgramNode).statements);
		const classificationToken = result?.classification;
		if (classificationToken?.lexeme) {
			const classification = normalizeClassification(classificationToken.lexeme, defaults);
			if (classification) {
				return { classification, supplier: '' };
			}
		}
		return null;
	} catch {
		return null;
	}
}

function getClassificationFromDocument(document: TextDocument, params: TextDocumentPositionParams) {
	const lineRange = {
		start: { line: params.position.line, character: 0 },
		end: { line: params.position.line + 1, character: 0 }
	};

	const lineText = document.getText(lineRange);
	const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };

	const contractMatch = lineText.match(/.*\b(sub|job)\s+([^\s]+)/i);
	if (contractMatch?.[2]) {
		const classification = normalizeClassification(contractMatch[2], defaults);
		if (classification) {
			return { classification, supplier: '' };
		}
	}

	const protocolMatch = lineText.match(/.*\b(host|join)\s+([^\s]+)/i);
	if (protocolMatch?.[2]) {
		const classification = normalizeClassification(protocolMatch[2], defaults);
		if (classification) {
			return { classification, supplier: '' };
		}
	}

	return getAstClassification(document, params);
}

connection.onRequest(fetchSpecificationRequest, async (params): Promise<FetchSpecificationResult> => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		connection.console.warn(`FetchSpecification: document not found for ${params.textDocument.uri}`);
		return null;
	}

	const parsed = getClassificationFromDocument(document, params);
	if (!parsed) {
		return null;
	}

	const spec = await gatewayClient.fetchContractSpec(parsed.classification);
	if (!spec) {
		return null;
	}

	return { classification: parsed.classification, specification: spec };
});

connection.onRequest(clearSpecCacheRequest, async (): Promise<boolean> => {
	try {
		gatewayClient.clearCache();
		return true;
	} catch (err: any) {
		connection.console.error(`Failed to clear specification cache: ${err?.message ?? err}`);
		return false;
	}
});

connection.onRequest(getSpecCachePathRequest, (): string => gatewayClient.cacheFilePath);

connection.onHover(async (params): Promise<Hover | null> => {
	const settings = await getDocumentSettings(params.textDocument.uri);
	const traceLevel = settings.traceServer ?? 'off';
	const started = performance.now();
	const hoverDebugLogging = settings.hoverDebugLogging;
	const hoverDisabled = settings.hoverDisabled ?? settings.hover?.disabled ?? true;
	const debugLog = (message: string) => {
		if (hoverDebugLogging) {
			connection.console.log(message);
		}
	};
	if (hoverDisabled) {
		traceDuration(traceLevel, 'hover', started, { reason: 'disabled', uri: params.textDocument.uri });
		return null;
	}

	const document = documents.get(params.textDocument.uri);
	if (!document) {
		connection.console.warn(`Hover: document not found for ${params.textDocument.uri}`);
		traceDuration(traceLevel, 'hover', started, { reason: 'missingDocument', uri: params.textDocument.uri });
		return null;
	}
	let contractSpecs: Record<string, RemoteContractSpec> | undefined;
	const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };
	const parsed = getClassificationFromDocument(document, params);
	if (parsed?.classification) {
		debugLog(`Hover: classification ${parsed.classification}, supplier=${parsed.supplier ?? ''}`);
		const spec = await gatewayClient.fetchContractSpec(parsed.classification);
		if (!spec) {
			debugLog(`Hover: no spec returned for ${parsed.classification}`);
		} else {
			contractSpecs = { [parsed.classification]: spec };
			debugLog(`Hover: fetched spec for ${parsed.classification} (not rendering spec hover)`);
		}
	} else {
		debugLog('Hover: no classification found for spec fetch');
	}

	const typeHover = getTypeHoverMarkdown(document, params.position, contractSpecs, defaults);
	if (typeHover) {
		debugLog(`Hover: type hover resolved at ${params.position.line}:${params.position.character} -> ${typeHover}`);
	}

	const parts = [typeHover].filter(Boolean) as string[];
	if (!parts.length) {
		traceDuration(traceLevel, 'hover', started, { reason: 'noContent', uri: params.textDocument.uri });
		return null;
	}

	const hoverResult = { contents: { kind: MarkupKind.Markdown, value: parts.join('\n\n---\n\n') } };
	traceDuration(traceLevel, 'hover', started, { uri: params.textDocument.uri, type: !!typeHover, spec: false });
	return hoverResult;
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	async (params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
	const settings = await getDocumentSettings(params.textDocument.uri);
	const traceLevel = settings.traceServer ?? 'off';
	const started = performance.now();
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		traceDuration(traceLevel, 'completion', started, { reason: 'missingDocument', uri: params.textDocument.uri });
		return [];
	}

	const specContext = shouldTriggerContractSpecCompletion(document, params.position);
	if (specContext) {
		const parsed = getClassificationFromDocument(document, params);
		if (parsed?.classification) {
			const spec = await gatewayClient.fetchContractSpec(parsed.classification);
			if (spec) {
				const specItems = buildContractSpecCompletionItems(
					spec,
					params.position,
					specContext.lineText,
					specContext.openParenIndex,
					specContext.keyword
				);
				if (specItems?.length) {
					const firstEdit = specItems[0].textEdit;
					// Apply the completion immediately to avoid showing a single-item popup.
					if (firstEdit && 'range' in firstEdit) {
						const result = await connection.workspace.applyEdit({
							changes: { [params.textDocument.uri]: [firstEdit] }
						});
						if (result?.applied) {
							traceDuration(traceLevel, 'completion', started, { uri: params.textDocument.uri, kind: 'contractSpec:applied' });
							return [];
						}
					}
					traceDuration(traceLevel, 'completion', started, { uri: params.textDocument.uri, kind: 'contractSpec:list' });
					return specItems;
				}
			}
		}
	}

	const protocolSpecContext = shouldTriggerProtocolSpecCompletion(document, params.position);
	if (protocolSpecContext) {
		const parsed = getClassificationFromDocument(document, params);
		if (parsed?.classification) {
			const spec = await gatewayClient.fetchProtocolSpec(parsed.classification);
			if (spec) {
				const specItems = buildProtocolSpecCompletionItems(
					spec,
					params.position,
					protocolSpecContext.lineText,
					protocolSpecContext.openParenIndex,
					protocolSpecContext.keyword
				);
				if (specItems?.length) {
					const firstEdit = specItems[0].textEdit;
					if (firstEdit && 'range' in firstEdit) {
						const result = await connection.workspace.applyEdit({
							changes: { [params.textDocument.uri]: [firstEdit] }
						});
						if (result?.applied) {
							traceDuration(traceLevel, 'completion', started, { uri: params.textDocument.uri, kind: 'protocolSpec:applied' });
							return [];
						}
					}
					traceDuration(traceLevel, 'completion', started, { uri: params.textDocument.uri, kind: 'protocolSpec:list' });
					return specItems;
				}
			}
		}
	}
	const result = buildCompletionItems(gatewayClient.completionCache, gatewayClient.protocolCache, document, params.position);
	traceDuration(traceLevel, 'completion', started, { uri: params.textDocument.uri });
	return result;
}
);

connection.onCompletionResolve((item): CompletionItem => item);

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
