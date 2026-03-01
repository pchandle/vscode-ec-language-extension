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
	Diagnostic,
	Hover,
	MarkupKind,
	TextDocumentPositionParams,
	RequestType,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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
import { normalizeContractClassification, normalizeProtocolClassification } from './lang/normalization';
import { collectReferencedClassifications } from './specReferenceCollector';

type FetchSpecificationParams = { textDocument: { uri: string }; position: { line: number; character: number } };
type FetchSpecificationResult = { classification: string; specification: any } | null;
type BulkValidationMode = 'autopilot' | 'pilot' | 'both';
type BulkValidationScanParams = {
	folderUris: string[];
	autopilotExtension: string;
	pilotExtension: string;
	mode: BulkValidationMode;
	maxFiles?: number;
	maxDiagnostics?: number;
	perFileMaxProblems?: number;
	scanId?: string;
};
type BulkValidationDiagnostic = {
	id: string;
	uri: string;
	message: string;
	source?: string;
	severity?: number;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	lineText: string;
};
type BulkValidationScanResult = {
	items: BulkValidationDiagnostic[];
	totalDiagnosticsFound: number;
	totalFilesWithDiagnostics: number;
	scannedFiles: number;
	matchedFiles: number;
	truncated: boolean;
	warnings: string[];
};
type BulkValidationProgress = {
	scanId: string;
	scannedFiles: number;
	matchedFiles: number;
	filesWithDiagnostics: number;
	diagnosticsLoaded: number;
};

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
type StudioConnectionConfig = { hostname: string; port: number; allowInsecure: boolean; network: string };
let studioConfig: StudioConnectionConfig = {
	hostname: 'localhost',
	port: 10000,
	allowInsecure: true,
	network: '31'
};

function normalizeStudioInitConfig(raw: any, fallback: StudioConnectionConfig): StudioConnectionConfig {
	if (!raw || typeof raw !== 'object') {
		return fallback;
	}
	return {
		hostname: typeof raw.hostname === 'string' && raw.hostname ? raw.hostname : fallback.hostname,
		port: typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : fallback.port,
		allowInsecure: typeof raw.allowInsecure === 'boolean' ? raw.allowInsecure : fallback.allowInsecure,
		network: typeof raw.network === 'string' && raw.network ? raw.network : fallback.network,
	};
}

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

const BULK_VALIDATION_MAX_FILES_DEFAULT = 2000;
const BULK_VALIDATION_MAX_DIAGNOSTICS_DEFAULT = 5000;
const BULK_VALIDATION_PER_FILE_MAX_DEFAULT = 100;
const BULK_VALIDATION_IGNORED_DIRS = new Set(['.git', 'node_modules', '.vscode-test', '.ops']);
const BULK_VALIDATION_PROGRESS_FILE_STEP = 25;

function normalizeExtension(value: string, fallback: string): string {
	const trimmed = (value || fallback).trim().toLowerCase();
	if (!trimmed) return fallback;
	return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function getBulkValidationExtensions(mode: BulkValidationMode, autopilotExtension: string, pilotExtension: string): Set<string> {
	const autoExt = normalizeExtension(autopilotExtension, '.dla');
	const pilotExt = normalizeExtension(pilotExtension, '.dlp');
	if (mode === 'pilot') return new Set([pilotExt]);
	if (mode === 'both') return new Set([autoExt, pilotExt]);
	return new Set([autoExt]);
}

function toFsPathFromUri(uri: string): string | null {
	try {
		return fileURLToPath(uri);
	} catch {
		return null;
	}
}

function makeDiagnosticId(uri: string, diagnostic: { message: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }): string {
	const range = diagnostic.range;
	return [
		uri,
		range.start.line,
		range.start.character,
		range.end.line,
		range.end.character,
		String(diagnostic.message || '').trim().toLowerCase(),
	].join('|');
}

async function collectMatchingFiles(
	rootDir: string,
	extensions: Set<string>,
	maxFiles: number,
	scannedCounter: { count: number },
	matchedCounter: { count: number }
): Promise<{ files: string[]; truncated: boolean }> {
	const files: string[] = [];
	const stack = [rootDir];
	let truncated = false;
	while (stack.length > 0 && !truncated) {
		const current = stack.pop() as string;
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		const directories: string[] = [];
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (!BULK_VALIDATION_IGNORED_DIRS.has(entry.name)) {
					directories.push(full);
				}
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			scannedCounter.count += 1;
			const ext = path.extname(entry.name).toLowerCase();
			if (!extensions.has(ext)) {
				continue;
			}
			files.push(full);
			matchedCounter.count += 1;
			if (matchedCounter.count >= maxFiles) {
				truncated = true;
				break;
			}
		}
		for (let i = directories.length - 1; i >= 0; i--) {
			stack.push(directories[i]);
		}
	}
	return { files, truncated };
}

async function runBulkValidationScan(params: BulkValidationScanParams): Promise<BulkValidationScanResult> {
	const scanId = params.scanId ?? String(Date.now());
	const maxFiles = Number.isFinite(params.maxFiles) && (params.maxFiles as number) > 0
		? Number(params.maxFiles)
		: BULK_VALIDATION_MAX_FILES_DEFAULT;
	const maxDiagnostics = Number.isFinite(params.maxDiagnostics) && (params.maxDiagnostics as number) > 0
		? Number(params.maxDiagnostics)
		: BULK_VALIDATION_MAX_DIAGNOSTICS_DEFAULT;
	const perFileMaxProblems = Number.isFinite(params.perFileMaxProblems) && (params.perFileMaxProblems as number) > 0
		? Number(params.perFileMaxProblems)
		: BULK_VALIDATION_PER_FILE_MAX_DEFAULT;
	const mode = params.mode ?? 'autopilot';
	const extensions = getBulkValidationExtensions(mode, params.autopilotExtension, params.pilotExtension);
	const warnings: string[] = [];
	const items: BulkValidationDiagnostic[] = [];
	const scannedCounter = { count: 0 };
	const matchedCounter = { count: 0 };
	let totalDiagnosticsFound = 0;
	let totalFilesWithDiagnostics = 0;
	let matchedFiles = 0;
	let truncated = false;
	let lastProgressMatchedFiles = 0;
	const maybeEmitProgress = (force = false) => {
		if (!force && matchedFiles - lastProgressMatchedFiles < BULK_VALIDATION_PROGRESS_FILE_STEP) {
			return;
		}
		lastProgressMatchedFiles = matchedFiles;
		const progress: BulkValidationProgress = {
			scanId,
			scannedFiles: scannedCounter.count,
			matchedFiles,
			filesWithDiagnostics: totalFilesWithDiagnostics,
			diagnosticsLoaded: items.length,
		};
		connection.sendNotification('emergent/bulkValidationProgress', progress);
	};

	for (const folderUri of params.folderUris ?? []) {
		const folderPath = toFsPathFromUri(folderUri);
		if (!folderPath) {
			warnings.push(`Skipped non-file URI: ${folderUri}`);
			continue;
		}
		const { files, truncated: fileTruncated } = await collectMatchingFiles(folderPath, extensions, maxFiles, scannedCounter, matchedCounter);
		if (fileTruncated) {
			truncated = true;
		}
		for (const filePath of files) {
			let text: string;
			try {
				text = await fs.promises.readFile(filePath, 'utf8');
			} catch {
				continue;
			}
			matchedFiles += 1;
			const uri = pathToFileURL(filePath).toString();
			const doc = TextDocument.create(uri, 'emergent', 1, text);
			const diagnostics = await collectSpecAwareDiagnosticsForDocument(doc, perFileMaxProblems);
			if (diagnostics.length === 0) {
				maybeEmitProgress();
				continue;
			}
			totalFilesWithDiagnostics += 1;
			totalDiagnosticsFound += diagnostics.length;
			const lines = text.split(/\r?\n/);
			for (const diagnostic of diagnostics) {
				if (items.length < maxDiagnostics) {
					items.push({
						id: makeDiagnosticId(uri, diagnostic),
						uri,
						message: diagnostic.message,
						source: diagnostic.source,
						severity: diagnostic.severity,
						range: diagnostic.range,
						lineText: lines[diagnostic.range.start.line] ?? '',
					});
				} else {
					truncated = true;
				}
			}
			maybeEmitProgress();
		}
	}
	maybeEmitProgress(true);

	return {
		items,
		totalDiagnosticsFound,
		totalFilesWithDiagnostics,
		scannedFiles: scannedCounter.count,
		matchedFiles,
		truncated,
		warnings,
	};
}


connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;
	gatewayClient.setConfig(studioConfig);
	const initOptions: any = params.initializationOptions ?? {};
	const incomingStudio = initOptions.studio ?? initOptions.gateway;
	if (incomingStudio) {
		studioConfig = normalizeStudioInitConfig(incomingStudio, studioConfig);
		gatewayClient.setConfig(studioConfig);
	}
	gatewayClient.setNetworkPaths(studioConfig.network);

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
	gatewayClient.setCacheConfig({
		softTtlHours: defaultSettings.specCache?.softTtlHours,
		fetchConcurrency: defaultSettings.specCache?.fetchConcurrency,
		retryCount: defaultSettings.specCache?.retryCount,
		retryBaseMs: defaultSettings.specCache?.retryBaseMs,
		allowStale: defaultSettings.specCache?.allowStale,
		enableRootDocFallback: defaultSettings.specCache?.enableRootDocFallback,
		requestTimeoutMs: defaultSettings.specCache?.requestTimeoutMs,
		failureTtlMs: defaultSettings.specCache?.failureTtlMs,
		rootRefreshMinutes: defaultSettings.specCache?.rootRefreshMinutes,
	});
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
	studioNetwork: string;
	hoverDisabled?: boolean;
	hover?: { disabled?: boolean };
	traceServer?: TraceLevel;
	specCache?: {
		softTtlHours?: number;
		fetchConcurrency?: number;
		retryCount?: number;
		retryBaseMs?: number;
		allowStale?: boolean;
		enableRootDocFallback?: boolean;
		requestTimeoutMs?: number;
		failureTtlMs?: number;
		rootRefreshMinutes?: number;
	};
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: EmergentSettings = {
	maxNumberOfProblems: 100,
	hoverDebugLogging: false,
	studioNetwork: '31',
	hoverDisabled: true,
	traceServer: 'off',
	specCache: {
		softTtlHours: 24,
		fetchConcurrency: 6,
		retryCount: 2,
		retryBaseMs: 250,
		allowStale: true,
		enableRootDocFallback: false,
		requestTimeoutMs: 10000,
		failureTtlMs: 15000,
		rootRefreshMinutes: 30,
	}
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
		gatewayClient.setCacheConfig({
			softTtlHours: globalSettings.specCache?.softTtlHours,
			fetchConcurrency: globalSettings.specCache?.fetchConcurrency,
			retryCount: globalSettings.specCache?.retryCount,
			retryBaseMs: globalSettings.specCache?.retryBaseMs,
			allowStale: globalSettings.specCache?.allowStale,
			enableRootDocFallback: globalSettings.specCache?.enableRootDocFallback,
			requestTimeoutMs: globalSettings.specCache?.requestTimeoutMs,
			failureTtlMs: globalSettings.specCache?.failureTtlMs,
			rootRefreshMinutes: globalSettings.specCache?.rootRefreshMinutes,
		});
	}

	const studioNetwork = typeof change.settings?.studio?.network === 'string'
		? change.settings.studio.network
		: typeof change.settings?.gateway?.network === 'string'
			? change.settings.gateway.network
			: undefined;
	const studioHost = typeof change.settings?.studio?.hostname === 'string'
		? change.settings.studio.hostname
		: typeof change.settings?.gateway?.hostname === 'string'
			? change.settings.gateway.hostname
			: undefined;
	const studioPort = typeof change.settings?.studio?.port === 'number'
		? change.settings.studio.port
		: typeof change.settings?.gateway?.port === 'number'
			? change.settings.gateway.port
			: undefined;
	const studioAllowInsecure = typeof change.settings?.studio?.allowInsecure === 'boolean'
		? change.settings.studio.allowInsecure
		: typeof change.settings?.gateway?.allowInsecure === 'boolean'
			? change.settings.gateway.allowInsecure
			: undefined;
	if (studioHost || studioPort !== undefined || studioAllowInsecure !== undefined) {
		studioConfig = {
			...studioConfig,
			...(studioHost ? { hostname: studioHost } : {}),
			...(studioPort !== undefined ? { port: studioPort } : {}),
			...(studioAllowInsecure !== undefined ? { allowInsecure: studioAllowInsecure } : {}),
		};
		gatewayClient.setConfig(studioConfig);
	}
	if (studioNetwork) {
		studioConfig.network = studioNetwork;
		gatewayClient.setNetworkPaths(studioConfig.network);
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

async function collectSpecAwareDiagnosticsForDocument(
	textDocument: TextDocument,
	maxNumberOfProblems: number
): Promise<Diagnostic[]> {
	const text = textDocument.getText();
	const defaults = getDefaultsFromText(text) || { layer: '', variation: '', platform: '', supplier: '' };

	// Match live validation behavior: fetch referenced specs before type-checking.
	const { program } = parseText(text);
	const { classifications, classificationKinds, rawToNormalized } = collectReferencedClassifications(
		program as ProgramNode,
		{ layer: defaults.layer, variation: defaults.variation, platform: defaults.platform }
	);

	const specs: Record<string, RemoteContractSpec> = {};
	const specLookupIssues: Record<string, string> = {};
	for (const cls of classifications) {
		try {
			const kind = classificationKinds.get(cls) ?? 'contract';
			const result = await gatewayClient.fetchSpecResult(cls, { kind, defaults });
			const spec = result.spec;
			if (spec) {
				specs[cls] = spec as any;
				for (const [raw, norm] of rawToNormalized.entries()) {
					if (norm === cls && raw !== cls) {
						specs[raw] = spec as any;
					}
				}
			} else if (result.reason) {
				specLookupIssues[cls] = result.reason;
				for (const [raw, norm] of rawToNormalized.entries()) {
					if (norm === cls && raw !== cls) {
						specLookupIssues[raw] = result.reason;
					}
				}
			}
		} catch (err: any) {
			connection.console.warn(`Diagnostics: failed to fetch spec ${cls}: ${err?.message ?? err}`);
			const fallbackReason = err?.message ?? String(err);
			specLookupIssues[cls] = fallbackReason;
			for (const [raw, norm] of rawToNormalized.entries()) {
				if (norm === cls && raw !== cls) {
					specLookupIssues[raw] = fallbackReason;
				}
			}
		}
	}

	return collectDiagnostics(
		textDocument,
		{ maxNumberOfProblems },
		specs,
		defaults,
		specLookupIssues
	);
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	const settings = await getDocumentSettings(textDocument.uri);
	gatewayClient.setCacheConfig({
		softTtlHours: settings.specCache?.softTtlHours,
		fetchConcurrency: settings.specCache?.fetchConcurrency,
		retryCount: settings.specCache?.retryCount,
		retryBaseMs: settings.specCache?.retryBaseMs,
		allowStale: settings.specCache?.allowStale,
		enableRootDocFallback: settings.specCache?.enableRootDocFallback,
		requestTimeoutMs: settings.specCache?.requestTimeoutMs,
		failureTtlMs: settings.specCache?.failureTtlMs,
		rootRefreshMinutes: settings.specCache?.rootRefreshMinutes,
	});
	const traceLevel = settings.traceServer ?? 'off';
	const started = performance.now();
	const diagnostics = await collectSpecAwareDiagnosticsForDocument(
		textDocument,
		settings.maxNumberOfProblems ?? defaultSettings.maxNumberOfProblems
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
const reloadSpecCacheRequest = new RequestType<null, boolean, void>('emergent/reloadSpecCache');
const findWorkspaceDiagnosticsRequest = new RequestType<BulkValidationScanParams, BulkValidationScanResult, void>('emergent/findWorkspaceDiagnostics');
const validateDocumentRequest = new RequestType<{ uri: string; clearOthers?: boolean }, boolean, void>('emergent/validateDocument');

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

function rangeContainsPosition(range: { start: { line: number; character: number }; end: { line: number; character: number } }, position: { line: number; character: number }) {
	if (position.line < range.start.line || position.line > range.end.line) return false;
	if (position.line === range.start.line && position.character < range.start.character) return false;
	if (position.line === range.end.line && position.character > range.end.character) return false;
	return true;
}

function getAstClassification(
	document: TextDocument,
	params: TextDocumentPositionParams
): { classification: string; supplier: string; kind?: 'contract' | 'protocol' } | null {
	try {
		const { program } = parseText(document.getText());
		const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };

		const findStmt = (
			statements: Statement[],
			inheritedClassification?: { lexeme: string },
			inheritedKind?: 'contract' | 'protocol'
		): { stmt: Statement; classification?: { lexeme: string }; kind?: 'contract' | 'protocol' } | null => {
			for (const stmt of statements) {
				if (!rangeContainsPosition(stmt.range, params.position)) continue;

				const currentClassification = (stmt as any)?.classification ?? inheritedClassification;
				const currentKind =
					((stmt as any).keyword?.lexeme?.toLowerCase?.() === 'host' ||
						(stmt as any).keyword?.lexeme?.toLowerCase?.() === 'join')
						? 'protocol'
						: ((stmt as any).keyword?.lexeme?.toLowerCase?.() === 'sub' ||
								(stmt as any).keyword?.lexeme?.toLowerCase?.() === 'job')
						? 'contract'
						: inheritedKind;

				// Recurse into inner statements first for most specific match.
				const jobBody = (stmt as any).body;
				if (jobBody?.statements) {
					const inner = findStmt(jobBody.statements, currentClassification, currentKind);
					if (inner) return inner;
				}
				const block = (stmt as any).block;
				if (block?.statements) {
					const inner = findStmt(block.statements, currentClassification, currentKind);
					if (inner) return inner;
				}
				return { stmt, classification: currentClassification, kind: currentKind };
			}
			return null;
		};

		const result = findStmt((program as unknown as ProgramNode).statements);
		const classificationToken = result?.classification;
		if (classificationToken?.lexeme) {
			const classification =
				result?.kind === 'protocol'
					? normalizeProtocolClassification(classificationToken.lexeme, defaults)
					: normalizeContractClassification(classificationToken.lexeme, defaults);
			if (classification) {
				return { classification, supplier: '', kind: result?.kind ?? 'contract' } as any;
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
		const classification = normalizeContractClassification(contractMatch[2], defaults);
		if (classification) {
			return { classification, supplier: '', kind: 'contract' as const };
		}
	}

	const protocolMatch = lineText.match(/.*\b(host|join)\s+([^\s]+)/i);
	if (protocolMatch?.[2]) {
		const classification = normalizeProtocolClassification(protocolMatch[2], defaults);
		if (classification) {
			return { classification, supplier: '', kind: 'protocol' as const };
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

	const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };
	const result = await gatewayClient.fetchSpecResult(parsed.classification, {
		kind: parsed.kind === 'protocol' ? 'protocol' : 'contract',
		defaults,
	});
	const spec = result.spec;
	if (!spec) {
		return null;
	}
	scheduleValidation(document);

	return { classification: result.canonical ?? parsed.classification, specification: spec };
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
connection.onRequest(reloadSpecCacheRequest, async (): Promise<boolean> => {
	try {
		await gatewayClient.refreshContractCache();
		return true;
	} catch (err: any) {
		connection.console.error(`Failed to reload specification cache: ${err?.message ?? err}`);
		return false;
	}
});
connection.onRequest(findWorkspaceDiagnosticsRequest, async (params): Promise<BulkValidationScanResult> => {
	try {
		return await runBulkValidationScan(params);
	} catch (err: any) {
		connection.console.error(`Bulk validation scan failed: ${err?.message ?? err}`);
		return {
			items: [],
			totalDiagnosticsFound: 0,
			totalFilesWithDiagnostics: 0,
			scannedFiles: 0,
			matchedFiles: 0,
			truncated: false,
			warnings: [`Scan failed: ${err?.message ?? String(err)}`],
		};
	}
});
connection.onRequest(validateDocumentRequest, async (params): Promise<boolean> => {
	const document = documents.get(params.uri);
	if (!document) {
		return false;
	}
	if (params.clearOthers) {
		for (const openDocument of documents.all()) {
			if (openDocument.uri !== params.uri) {
				connection.sendDiagnostics({ uri: openDocument.uri, diagnostics: [] });
			}
		}
	}
	clearScheduledValidation(params.uri);
	await validateTextDocument(document);
	return true;
});

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
	const parsed = getClassificationFromDocument(document, params) as any;
	if (parsed?.classification) {
		debugLog(`Hover: classification ${parsed.classification}, supplier=${parsed.supplier ?? ''}`);
		const normalized =
			parsed.kind === 'protocol'
				? normalizeProtocolClassification(parsed.classification, defaults)
				: normalizeContractClassification(parsed.classification, defaults);
		const clsToFetch = normalized ?? parsed.classification;
		const result = await gatewayClient.fetchSpecResult(clsToFetch, {
			kind: parsed.kind === 'protocol' ? 'protocol' : 'contract',
			defaults,
		});
		const spec = result.spec;
		if (!spec) {
			debugLog(`Hover: no spec returned for ${clsToFetch}`);
		} else {
			contractSpecs = { [clsToFetch]: spec as any };
			if (clsToFetch !== parsed.classification) {
				contractSpecs[parsed.classification] = spec as any;
			}
			debugLog(`Hover: fetched spec for ${clsToFetch} (not rendering spec hover)`);
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
			const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };
			const result = await gatewayClient.fetchSpecResult(parsed.classification, {
				kind: 'contract',
				defaults,
			});
			const spec = result.spec as RemoteContractSpec | null;
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
			const defaults = getDefaultsFromText(document.getText()) || { layer: '', variation: '', platform: '', supplier: '' };
			const result = await gatewayClient.fetchSpecResult(parsed.classification, {
				kind: 'protocol',
				defaults,
			});
			const spec = result.spec as any;
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
