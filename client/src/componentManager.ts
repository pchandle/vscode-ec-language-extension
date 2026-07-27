import * as fs from "fs/promises";
import { Dirent } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findNodeAtLocation, parse as parseJsonc, parseTree as parseJsoncTree } from "jsonc-parser";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { LanguageClient } from "vscode-languageclient/node";
import { findPddForVersion } from "./pddLoader";
import { PdesDesign, Pspec, transformPdesToPspec } from "./pdes/transform";
import { loadPdesSchema } from "./customEditors/PdesEditorProvider";
import { ExpressionDiagnostic, projectComponentGraph, ProjectionJobInput, SourceRef as ProjectionSourceRef } from "./componentManagerProjection";

type SourceRef = ProjectionSourceRef;
type Topic = { name?: string; type?: string; protocol?: string; [key: string]: unknown };
type Role = { requirements: Topic[]; obligations: Topic[] };
type ProtocolRecord = {
  classification: string;
  uri: vscode.Uri;
  kind: "managed" | "legacy";
  interface?: { host: Role; join: Role };
  error?: string;
};
type ContractRecord = { classification: string; uri: vscode.Uri; requirements: Topic[]; obligations: Topic[]; requirementSources: SourceRef[]; obligationSources: SourceRef[] };
type Label = { label: string; range: SourceRef["range"] };
type Participation = { role: "host" | "join"; classification: string | null; rawClassification?: string; requirements: Label[]; obligations: Label[]; range: SourceRef["range"] };
type Job = {
  key: string;
  uri: vscode.Uri;
  classification: string | null;
  rawClassification?: string;
  requirements: Label[];
  obligations: Label[];
  range: SourceRef["range"];
  bodyRange: SourceRef["range"];
  statements: Participation[];
};
type ManagerDiagnostic = { severity: "error" | "warning"; message: string; source: SourceRef; related?: SourceRef[] };
type Snapshot = { protocols: Map<string, ProtocolRecord[]>; contracts: Map<string, ContractRecord[]>; jobs: Job[]; expressionFiles: Map<string, { uri: vscode.Uri; jobs: number }> };
type ScanStatus = { indexing: boolean; processed: number; total: number };

type Analysis = { jobs: Array<Omit<Job, "key" | "uri">>; diagnostics: Array<{ message: string; range: SourceRef["range"] }> };

const MANAGER_SOURCE = "Component Manager";

function uriRef(uri: vscode.Uri, range?: SourceRef["range"]): SourceRef {
  return { uri: uri.toString(), range };
}

function positionAt(text: string, offset: number): { line: number; character: number } {
  const before = text.slice(0, Math.max(0, offset));
  const line = (before.match(/\n/g) ?? []).length;
  return { line, character: before.length - (before.lastIndexOf("\n") + 1) };
}

function jsonTopicSource(uri: vscode.Uri, text: string, lane: "requirements" | "obligations", index: number): SourceRef {
  const node = findNodeAtLocation(parseJsoncTree(text), [lane, index]);
  if (!node) return uriRef(uri);
  return uriRef(uri, { start: positionAt(text, node.offset), end: positionAt(text, node.offset + node.length) });
}

function toRange(range?: SourceRef["range"]): vscode.Range {
  if (!range) return new vscode.Range(0, 0, 0, 1);
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

function topicLabel(topic: Topic): string {
  const base = String(topic.name ?? "topic")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "topic";
  return base;
}

function uniqueLabels(topics: Topic[], occupied: Set<string>, selfLabel?: string, selfIndex?: number): string[] {
  return topics.map((topic, index) => {
    if (index === selfIndex && selfLabel) {
      occupied.add(selfLabel);
      return selfLabel;
    }
    const base = topicLabel(topic);
    let candidate = base;
    let suffix = 2;
    while (occupied.has(candidate)) candidate = `${base}_${suffix++}`;
    occupied.add(candidate);
    return candidate;
  });
}

function topicKey(topic: Topic): string {
  return JSON.stringify({ type: topic.type, name: topic.name, protocol: topic.protocol });
}

/** Map old labels onto a changed topic list. Exact topic matches support reorders;
 * unmatched positions are only treated as in-place edits when unambiguous. */
function reconcileLabels(oldTopics: Topic[], newTopics: Topic[], oldLabels: string[]): { labels?: string[]; error?: string } {
  const matches = new Map<number, number>();
  const oldByKey = new Map<string, number[]>();
  oldTopics.forEach((topic, index) => oldByKey.set(topicKey(topic), [...(oldByKey.get(topicKey(topic)) ?? []), index]));
  for (let newIndex = 0; newIndex < newTopics.length; newIndex++) {
    const candidates = oldByKey.get(topicKey(newTopics[newIndex])) ?? [];
    if (candidates.length === 1 && ![...matches.values()].includes(candidates[0])) matches.set(newIndex, candidates[0]);
    else if (candidates.length > 1) return { error: "ambiguous duplicate topic mapping" };
  }
  const unmatchedNew = newTopics.map((_, i) => i).filter((i) => !matches.has(i));
  const unmatchedOld = oldTopics.map((_, i) => i).filter((i) => ![...matches.values()].includes(i));
  // A single unmatched pair represents an in-place name/type edit. More than
  // one pair has no stable identity in the published protocol format.
  if (unmatchedNew.length > 1 && unmatchedOld.length > 1) return { error: "ambiguous changed-topic mapping" };
  if (unmatchedNew.length === 1 && unmatchedOld.length === 1) matches.set(unmatchedNew[0], unmatchedOld[0]);
  const occupied = new Set<string>();
  const labels = newTopics.map((topic, index) => {
    const oldIndex = matches.get(index);
    if (oldIndex !== undefined && oldLabels[oldIndex]) {
      occupied.add(oldLabels[oldIndex]);
      return oldLabels[oldIndex];
    }
    return uniqueLabels([topic], occupied)[0];
  });
  return { labels };
}

function findSelf(topics: Topic[], classification: string): { index?: number; error?: string } {
  const matches = topics
    .map((topic, index) => ({ topic, index }))
    .filter(({ topic }) => topic.name === "<self>" && topic.type === "abstraction" && topic.protocol === classification);
  if (matches.length === 1) return { index: matches[0].index };
  return { error: matches.length === 0 ? "missing or invalid <self> topic" : "duplicate <self> topics" };
}

function protocolRole(protocol: ProtocolRecord, role: "host" | "join"): Role | undefined {
  return protocol.interface?.[role];
}

function graphSelfSlots(protocol: ProtocolRecord | undefined): { slots: Partial<Record<"host" | "join", number>>; unavailable: Partial<Record<"host" | "join", string>> } {
  const slots: Partial<Record<"host" | "join", number>> = {};
  const unavailable: Partial<Record<"host" | "join", string>> = {};
  if (!protocol || protocol.kind !== "managed") {
    const reason = protocol?.kind === "legacy" ? "legacy protocols do not expose managed <self> mappings" : "the selected protocol is unresolved";
    return { slots, unavailable: { host: reason, join: reason } };
  }
  (["host", "join"] as const).forEach((role) => {
    const interfaceRole = protocolRole(protocol, role);
    if (!interfaceRole) {
      unavailable[role] = "the protocol interface is unavailable";
      return;
    }
    const topics = role === "host" ? interfaceRole.obligations : interfaceRole.requirements;
    const self = findSelf(topics, protocol.classification);
    if (self.index === undefined) unavailable[role] = self.error ?? "the <self> mapping is unavailable";
    else slots[role] = self.index;
  });
  return { slots, unavailable };
}

function configuredDirectories(): vscode.Uri[] {
  const values = vscode.workspace.getConfiguration("componentManager").get<string[]>("componentDirectories", []) ?? [];
  return values
    .filter(Boolean)
    .map((value) => {
      // A Windows path such as C:\\components is syntactically a URI with
      // scheme "c" to Uri.parse(), so recognise filesystem paths first.
      if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
        return vscode.Uri.file(value);
      }
      try {
        const parsed = vscode.Uri.parse(value);
        return parsed.scheme ? parsed : vscode.Uri.file(value);
      } catch {
        return vscode.Uri.file(value);
      }
    });
}

function autopilotExtension(): string {
  const configured = vscode.workspace.getConfiguration("emergent").get<string>("autopilotExtension", ".dla") || ".dla";
  return configured.startsWith(".") ? configured.toLowerCase() : `.${configured.toLowerCase()}`;
}

async function filesBelow(root: vscode.Uri): Promise<vscode.Uri[]> {
  if (root.scheme !== "file") return [];
  const found: vscode.Uri[] = [];
  async function visit(directory: string): Promise<void> {
    let entries: Dirent[];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) found.push(vscode.Uri.file(full));
    }
  }
  await visit(root.fsPath);
  return found;
}

class ComponentManagerSidebar implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly manager: ComponentManager, private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: any) => {
      if (message?.type === "ready") this.refresh();
      if (message?.type === "openProtocol") void vscode.commands.executeCommand("emergent.openComponentManagerGraph", message.classification);
      if (message?.type === "openSource") void vscode.commands.executeCommand("emergent.openComponentManagerSource", message.source);
    });
    view.onDidDispose(() => { this.view = undefined; });
    this.refresh();
  }

  refresh(): void {
    if (!this.view) return;
    const protocols = this.manager.protocols().map((protocol) => {
      const directUseCount = this.manager.usageCount(protocol.classification);
      return {
        directUseCount,
        kind: "protocol",
        classification: protocol.classification,
        managed: protocol.kind === "managed",
        detail: protocol.kind === "legacy" ? `Legacy / published only · ${directUseCount} direct uses` : `${directUseCount} direct uses`,
        source: uriRef(protocol.uri),
      };
    });
    const contracts = this.manager.contracts().map((contract) => ({ kind: "contract", classification: contract.classification, detail: "Contract specification", source: uriRef(contract.uri) }));
    void this.view.webview.postMessage({ type: "componentManagerSidebar", status: this.manager.scanStatus(), protocols, contracts, diagnostics: this.manager.diagnostics(), directories: this.manager.directories().map((directory) => directory.fsPath) });
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';"></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;

    /* Retained while upgrading the existing view to the shared React bundle.
    // The return above is the active sidebar implementation.
    const nonce = Math.random().toString(36).slice(2);
    const script = `const vscode=acquireVsCodeApi();let state={protocols:[],contracts:[],diagnostics:[]};let whole=false,regex=false;const q=document.getElementById('query'),contracts=document.getElementById('contracts'),protocols=document.getElementById('protocols'),results=document.getElementById('results'),status=document.getElementById('status'),count=document.getElementById('count'),diagnostics=document.getElementById('diagnostics');const escapeRegex=s=>s.replace(/[.*+?^{}()|[\\]\\\\]/g,'\\\\$&').replaceAll(String.fromCharCode(36),'\\\\$&');function matches(value){const term=q.value;if(!term)return true;try{if(regex)return new RegExp(term,'i').test(value);if(whole)return new RegExp('(^|[^A-Za-z0-9_])'+escapeRegex(term)+'($|[^A-Za-z0-9_])','i').test(value);return value.toLowerCase().includes(term.toLowerCase())}catch{return false}}function render(){const entries=[...(protocols.checked?state.protocols:[]),...(contracts.checked?state.contracts:[])].filter(e=>matches(e.classification));results.replaceChildren();for(const entry of entries){const button=document.createElement('button');button.className='result '+entry.kind;button.type='button';const label=document.createElement('span');label.textContent=entry.classification;const detail=document.createElement('small');detail.textContent=entry.detail;button.append(label,detail);button.onclick=()=>vscode.postMessage(entry.kind==='protocol'?{type:'openProtocol',classification:entry.classification}:{type:'openSource',source:entry.source});results.append(button)}count.textContent=entries.length+' result'+(entries.length===1?'':'s');diagnostics.replaceChildren(...state.diagnostics.map(d=>{const b=document.createElement('button');b.className='diagnostic';b.textContent=d.severity+': '+d.message;b.onclick=()=>vscode.postMessage({type:'openSource',source:d.source});return b}))}for(const el of [q,contracts,protocols])el.addEventListener('input',render);document.getElementById('whole').onclick=e=>{whole=!whole;e.currentTarget.setAttribute('aria-pressed',whole);render()};document.getElementById('regex').onclick=e=>{regex=!regex;e.currentTarget.setAttribute('aria-pressed',regex);render()};window.addEventListener('message',e=>{if(e.data.type!=='state')return;state=e.data;status.textContent=state.status.indexing?'Indexing Component Manager — '+state.status.processed+' / '+state.status.total:'Index ready · '+state.protocols.length+' protocols · '+state.contracts.length+' contracts';render()});`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"></head><body><main><div class="search"><input id="query" type="search" placeholder="Search component library" aria-label="Search component library"><button id="whole" title="Match whole word" aria-pressed="false">ab</button><button id="regex" title="Use regular expression" aria-pressed="false">.*</button></div><div class="scope"><label><input id="contracts" type="checkbox"> Contracts</label><label><input id="protocols" type="checkbox" checked> Protocols</label><span id="count"></span></div><p id="status" role="status"></p><section id="results" aria-label="Component library results"></section><section id="diagnostics"></section></main><script nonce="${nonce}">${script}</script><style>body{padding:0;margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font-family:var(--vscode-font-family);font-size:13px}main{padding:6px}.search{display:flex;border:1px solid var(--vscode-focusBorder);border-radius:2px;overflow:hidden}.search input{flex:1;min-width:0;padding:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:0;outline:0}.search button{min-width:28px;background:transparent;color:var(--vscode-input-foreground);border:0;border-left:1px solid var(--vscode-input-border);cursor:pointer}.search button[aria-pressed=true]{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.scope{display:flex;gap:10px;align-items:center;padding:7px 2px;border-bottom:1px solid var(--vscode-sideBarSectionHeader-border)}.scope label{white-space:nowrap}.scope #count{margin-left:auto;color:var(--vscode-descriptionForeground)}#status{margin:7px 2px;color:var(--vscode-descriptionForeground)}#results{display:flex;flex-direction:column}.result,.diagnostic{display:flex;flex-direction:column;align-items:stretch;text-align:left;padding:5px 3px;background:transparent;border:0;color:var(--vscode-foreground);cursor:pointer}.result:hover,.diagnostic:hover{background:var(--vscode-list-hoverBackground)}.result span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.result small{color:var(--vscode-descriptionForeground);margin-top:2px}.protocol span:before{content:'◌ ';color:var(--vscode-charts-blue)}.contract span:before{content:'□ ';color:var(--vscode-charts-green)}.diagnostic{color:var(--vscode-inputValidation-warningForeground)}</style></body></html>`; */
  }
}

export class ComponentManager implements vscode.Disposable {
  private snapshot: Snapshot = { protocols: new Map(), contracts: new Map(), jobs: [], expressionFiles: new Map() };
  private readonly diagnosticCollection = vscode.languages.createDiagnosticCollection("component-manager");
  private readonly sidebar: ComponentManagerSidebar;
  private readonly disposables: vscode.Disposable[] = [];
  private directoryWatchers: vscode.FileSystemWatcher[] = [];
  private graphPanel: vscode.WebviewPanel | undefined;
  private selectedProtocol: string | undefined;
  private refreshRunning: Promise<void> | undefined;
  private pdesValidator: ReturnType<Ajv["compile"]> | undefined;
  private currentScan: ScanStatus = { indexing: false, processed: 0, total: 0 };

  constructor(private readonly context: vscode.ExtensionContext, private readonly client: LanguageClient) {
    this.sidebar = new ComponentManagerSidebar(this, context);
    context.subscriptions.push(this.diagnosticCollection, vscode.window.registerWebviewViewProvider("emergent.componentManager", this.sidebar, { webviewOptions: { retainContextWhenHidden: true } }));
    this.register();
  }

  private register(): void {
    this.disposables.push(
      vscode.commands.registerCommand("emergent.refreshComponentManager", () => void this.refresh()),
      vscode.commands.registerCommand("emergent.openComponentManagerGraph", (classification?: string) => void this.openGraph(classification)),
      vscode.commands.registerCommand("emergent.openComponentManagerSource", (source: SourceRef) => void this.openSource(source)),
      vscode.workspace.onDidSaveTextDocument((document) => void this.onSave(document)),
      vscode.languages.onDidChangeDiagnostics((event) => {
        // Diagnostics are produced asynchronously by the language server. A
        // graph that is already open should reflect their current state
        // without requiring a Component Manager refresh or a saved document.
        if (this.graphPanel && this.selectedProtocol && event.uris.some((uri) => this.snapshot.expressionFiles.has(uri.toString()))) this.postGraph();
      }),
      vscode.workspace.onDidCreateFiles(() => void this.refresh()),
      vscode.workspace.onDidDeleteFiles(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("componentManager.componentDirectories")) this.resetDirectoryWatchers();
        if (event.affectsConfiguration("componentManager.componentDirectories") || event.affectsConfiguration("emergent.autopilotExtension")) void this.refresh();
      })
    );
    this.resetDirectoryWatchers();
    void this.refresh();
  }

  private resetDirectoryWatchers(): void {
    this.directoryWatchers.forEach((watcher) => watcher.dispose());
    this.directoryWatchers = [];
    for (const directory of configuredDirectories()) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, "**/*"));
      watcher.onDidCreate(() => void this.refresh());
      watcher.onDidChange(() => void this.refresh());
      watcher.onDidDelete(() => void this.refresh());
      this.directoryWatchers.push(watcher);
    }
  }

  dispose(): void { this.directoryWatchers.forEach((watcher) => watcher.dispose()); this.disposables.forEach((disposable) => disposable.dispose()); this.diagnosticCollection.dispose(); }
  protocols(): ProtocolRecord[] {
    return [...this.snapshot.protocols.values()]
      .map((entries) => entries.find((entry) => entry.kind === "managed") ?? entries.find((entry) => entry.kind === "legacy"))
      .filter((entry): entry is ProtocolRecord => Boolean(entry));
  }
  contracts(): ContractRecord[] { return [...this.snapshot.contracts.values()].flat(); }
  directories(): vscode.Uri[] { return configuredDirectories(); }
  scanStatus(): ScanStatus { return this.currentScan; }
  jobCount(): number { return this.snapshot.jobs.length; }
  diagnostics(): ManagerDiagnostic[] { return this.collectDiagnostics(this.snapshot); }
  usageCount(classification: string): number { return this.snapshot.jobs.filter((job) => job.statements.some((statement) => statement.classification === classification)).length; }

  async refresh(): Promise<void> {
    if (this.refreshRunning) return this.refreshRunning;
    this.refreshRunning = this.doRefresh().finally(() => {
      this.currentScan = { ...this.currentScan, indexing: false };
      this.refreshRunning = undefined;
      this.sidebar.refresh();
    });
    return this.refreshRunning;
  }

  private async doRefresh(): Promise<void> {
    const next: Snapshot = { protocols: new Map(), contracts: new Map(), jobs: [], expressionFiles: new Map() };
    const directories = configuredDirectories();
    const extension = autopilotExtension();
    const uris = (await Promise.all(directories.map(filesBelow))).flat().filter((uri) => {
      const ext = path.extname(uri.fsPath).toLowerCase();
      return [".pdes", ".pspec", ".cspec", extension].includes(ext);
    });
    // Protocols and contracts are cheap JSON reads. Analyse expressions only
    // after navigation data is available, so large component folders become
    // useful early rather than appearing blank for the full scan.
    const priority = (uri: vscode.Uri) => {
      const ext = path.extname(uri.fsPath).toLowerCase();
      return ext === ".pdes" ? 0 : ext === ".pspec" ? 1 : ext === ".cspec" ? 2 : ext === extension ? 3 : 4;
    };
    uris.sort((left, right) => priority(left) - priority(right));
    this.currentScan = { indexing: true, processed: 0, total: uris.length };
    this.sidebar.refresh();
    let publishedNavigation = false;
    for (const uri of uris) {
      const ext = path.extname(uri.fsPath).toLowerCase();
      if (!publishedNavigation && ext === extension) {
        // Make protocol search/navigation useful before the potentially large
        // expression-analysis phase has finished.
        this.snapshot = next;
        this.publishDiagnostics();
        this.sidebar.refresh();
        publishedNavigation = true;
      }
      let text: string;
      try { text = await fs.readFile(uri.fsPath, "utf8"); } catch { this.advanceScan(); continue; }
      if (ext === ".pdes") this.addManagedProtocol(next, uri, text);
      else if (ext === ".pspec") this.addLegacyProtocol(next, uri, text);
      else if (ext === ".cspec") this.addContract(next, uri, text);
      else await this.addExpression(next, uri, text);
      this.advanceScan();
    }
    // Open dirty autopilot documents are the authoritative source for an edit
    // that Component Manager may safely update; replace their indexed copy.
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === "file" && document.uri.fsPath.toLowerCase().endsWith(extension)) {
        next.jobs = next.jobs.filter((job) => job.uri.toString() !== document.uri.toString());
        next.expressionFiles.delete(document.uri.toString());
        await this.addExpression(next, document.uri, document.getText());
      }
    }
    this.snapshot = next;
    this.currentScan = { ...this.currentScan, indexing: false };
    this.publishDiagnostics();
    this.sidebar.refresh();
    if (this.selectedProtocol) this.postGraph();
  }

  private advanceScan(): void {
    this.currentScan = { ...this.currentScan, processed: this.currentScan.processed + 1 };
    if (this.currentScan.processed % 25 === 0 || this.currentScan.processed === this.currentScan.total) this.sidebar.refresh();
  }

  private addManagedProtocol(snapshot: Snapshot, uri: vscode.Uri, text: string): void {
    try {
      const design = parseJsonc(text) as PdesDesign;
      if (!this.isValidPdes(design)) throw new Error(".pdes schema validation failed");
      const { match } = findPddForVersion(this.context, design.protocolDesignVersion);
      if (!match?.definition) throw new Error(`no matching .pdd for version ${design.protocolDesignVersion}`);
      const transformed = transformPdesToPspec(design, match.definition);
      if (!transformed.pspec || transformed.errors?.length) throw new Error(transformed.errors?.map((error) => error.message).join("; ") || "transform failed");
      this.addProtocol(snapshot, { classification: transformed.pspec.name, uri, kind: "managed", interface: transformed.pspec });
    } catch (error: any) {
      const classification = `invalid:${uri.toString()}`;
      this.addProtocol(snapshot, { classification, uri, kind: "managed", error: error?.message ?? String(error) });
    }
  }

  private isValidPdes(design: unknown): boolean {
    if (!this.pdesValidator) {
      const schema = loadPdesSchema(this.context);
      if (!schema) return false;
      const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
      addFormats(ajv);
      this.pdesValidator = ajv.compile(schema);
    }
    return Boolean(this.pdesValidator(design));
  }

  private addLegacyProtocol(snapshot: Snapshot, uri: vscode.Uri, text: string): void {
    try {
      const spec = parseJsonc(text) as Pspec;
      if (spec?.type !== "protocol" || !spec.name) throw new Error("invalid protocol specification");
      this.addProtocol(snapshot, { classification: spec.name, uri, kind: "legacy", interface: spec });
    } catch { this.addProtocol(snapshot, { classification: `invalid:${uri.toString()}`, uri, kind: "legacy", error: "invalid .pspec" }); }
  }
  private addProtocol(snapshot: Snapshot, record: ProtocolRecord): void { snapshot.protocols.set(record.classification, [...(snapshot.protocols.get(record.classification) ?? []), record]); }
  private addContract(snapshot: Snapshot, uri: vscode.Uri, text: string): void {
    try {
      const spec = parseJsonc(text) as any;
      if (spec?.type !== "supplier" || !spec.name) throw new Error("invalid contract specification");
      const requirements = Array.isArray(spec.requirements) ? spec.requirements : [];
      const obligations = Array.isArray(spec.obligations) ? spec.obligations : [];
      const record: ContractRecord = {
        classification: spec.name,
        uri,
        requirements,
        obligations,
        requirementSources: requirements.map((_topic: Topic, index: number) => jsonTopicSource(uri, text, "requirements", index)),
        obligationSources: obligations.map((_topic: Topic, index: number) => jsonTopicSource(uri, text, "obligations", index)),
      };
      snapshot.contracts.set(record.classification, [...(snapshot.contracts.get(record.classification) ?? []), record]);
    } catch { /* schema diagnostics remain owned by the existing custom editor */ }
  }
  private async addExpression(snapshot: Snapshot, uri: vscode.Uri, text: string): Promise<void> {
    try {
      const analysis = await this.client.sendRequest<Analysis>("emergent/componentManager/analyseExpression", { text });
      analysis.jobs.forEach((job, index) => snapshot.jobs.push({ ...job, uri, key: `${uri.toString()}#${index}` }));
      snapshot.expressionFiles.set(uri.toString(), { uri, jobs: analysis.jobs.length });
    } catch { /* Language server readiness should not make scanning destructive. */ }
  }

  private collectDiagnostics(snapshot: Snapshot): ManagerDiagnostic[] {
    const diagnostics: ManagerDiagnostic[] = [];
    for (const [classification, protocols] of snapshot.protocols) {
      const managed = protocols.filter((protocol) => protocol.kind === "managed");
      if (managed.length > 1) managed.forEach((protocol) => diagnostics.push({ severity: "error", message: `Duplicate managed protocol definition for ${classification}`, source: uriRef(protocol.uri), related: managed.filter((other) => other !== protocol).map((other) => uriRef(other.uri)) }));
      protocols.filter((protocol) => protocol.error).forEach((protocol) => diagnostics.push({ severity: "error", message: `Cannot use managed protocol: ${protocol.error}`, source: uriRef(protocol.uri) }));
    }
    for (const expression of snapshot.expressionFiles.values()) {
      if (expression.jobs !== 1) diagnostics.push({ severity: "error", message: `Autopilot expression contains ${expression.jobs === 0 ? "no" : "multiple"} job blocks`, source: uriRef(expression.uri) });
    }
    for (const job of snapshot.jobs) {
      const source = uriRef(job.uri, job.range);
      const jobsInFile = snapshot.jobs.filter((other) => other.uri.toString() === job.uri.toString());
      if (jobsInFile.length === 1 && job.classification) {
        const expected = this.expectedExpressionFilename(job.classification);
        if (path.basename(job.uri.fsPath) !== expected) diagnostics.push({ severity: "warning", message: `Expression filename should be ${expected}`, source });
      }
      if (job.classification) {
        const contracts = snapshot.contracts.get(job.classification) ?? [];
        if (!contracts.length) diagnostics.push({ severity: "error", message: `Missing contract specification for ${job.classification}`, source: uriRef(vscode.Uri.file(path.dirname(job.uri.fsPath))) });
        if (contracts.length > 1) diagnostics.push({ severity: "error", message: `Duplicate contract specifications for ${job.classification}`, source, related: contracts.map((contract) => uriRef(contract.uri)) });
      }
    }
    return diagnostics;
  }

  private expectedExpressionFilename(classification: string): string {
    const parts = classification.split("/").filter(Boolean);
    const [layer, verb, subject, variation, platform] = parts;
    const format = vscode.workspace.getConfiguration("specification").get<string>("contractFilenameFormat", "{layer}--{verb}--{subject}--{variation}--{platform}") || "{layer}--{verb}--{subject}--{variation}--{platform}";
    return format.replace(/\{(layer|verb|subject|variation|platform)\}/g, (_match, key) => ({ layer, verb, subject, variation, platform } as Record<string, string>)[key] ?? "") + autopilotExtension();
  }

  private publishDiagnostics(): void {
    this.diagnosticCollection.clear();
    const byUri = new Map<string, vscode.Diagnostic[]>();
    for (const diagnostic of this.diagnostics()) {
      const uri = vscode.Uri.parse(diagnostic.source.uri);
      const item = new vscode.Diagnostic(toRange(diagnostic.source.range), diagnostic.message, diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      item.source = MANAGER_SOURCE;
      item.relatedInformation = diagnostic.related?.map((related) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.parse(related.uri), toRange(related.range)), "Related Component Manager source"));
      byUri.set(uri.toString(), [...(byUri.get(uri.toString()) ?? []), item]);
    }
    byUri.forEach((items, key) => this.diagnosticCollection.set(vscode.Uri.parse(key), items));
  }

  private async onSave(document: vscode.TextDocument): Promise<void> {
    const before = this.snapshot;
    const extension = document.uri.fsPath.toLowerCase();
    await this.refresh();
    if (extension.endsWith(".pdes")) await this.syncProtocol(before, document.uri);
    if (extension.endsWith(".cspec")) await this.syncContract(before, document.uri);
  }

  private managedProtocolForUri(snapshot: Snapshot, uri: vscode.Uri): ProtocolRecord | undefined { return [...snapshot.protocols.values()].flat().find((protocol) => protocol.kind === "managed" && protocol.uri.toString() === uri.toString()); }
  private resolvedProtocol(classification: string): ProtocolRecord | undefined {
    const entries = this.snapshot.protocols.get(classification) ?? [];
    const managed = entries.filter((entry) => entry.kind === "managed" && !entry.error);
    return managed.length === 1 ? managed[0] : entries.length === 1 && entries[0].kind === "legacy" ? entries[0] : undefined;
  }

  private async syncProtocol(before: Snapshot, uri: vscode.Uri): Promise<void> {
    const oldProtocol = this.managedProtocolForUri(before, uri);
    const newProtocol = this.managedProtocolForUri(this.snapshot, uri);
    if (!oldProtocol || !newProtocol || !oldProtocol.interface || !newProtocol.interface || oldProtocol.classification !== newProtocol.classification) return;
    const updates: Array<{ uri: vscode.Uri; range: vscode.Range; text: string }> = [];
    for (const job of this.snapshot.jobs) {
      const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === job.uri.toString());
      if (!document) continue; // V1 never changes closed expressions.
      for (const statement of job.statements.filter((candidate) => candidate.classification === newProtocol.classification)) {
        const role = statement.role;
        const oldRole = protocolRole(oldProtocol, role)!;
        const newRole = protocolRole(newProtocol, role)!;
        const req = reconcileLabels(oldRole.requirements, newRole.requirements, statement.requirements.map((label) => label.label));
        const ob = reconcileLabels(oldRole.obligations, newRole.obligations, statement.obligations.map((label) => label.label));
        if (req.error || ob.error) { this.reportMappingAmbiguity(newProtocol, job, `${role} ${req.error ?? ob.error}`); continue; }
        const replacement = this.renderStatement(statement, req.labels ?? [], ob.labels ?? []);
        updates.push({ uri: job.uri, range: toRange(statement.range), text: replacement });
      }
    }
    await this.applyEdits(updates);
  }

  private renderStatement(statement: Participation, requirements: string[], obligations: string[]): string {
    return `${statement.role} ${statement.rawClassification ?? statement.classification ?? ""}(${requirements.join(", ")})${obligations.length ? ` -> ${obligations.join(", ")}` : ""}`;
  }

  private async syncContract(before: Snapshot, uri: vscode.Uri): Promise<void> {
    const previous = [...before.contracts.values()].flat().find((contract) => contract.uri.toString() === uri.toString());
    const current = [...this.snapshot.contracts.values()].flat().find((contract) => contract.uri.toString() === uri.toString());
    if (!previous || !current || previous.classification !== current.classification) return;
    const resolved = this.snapshot.contracts.get(current.classification) ?? [];
    if (resolved.length !== 1) return;
    const updates: Array<{ uri: vscode.Uri; range: vscode.Range; text: string }> = [];
    for (const job of this.snapshot.jobs.filter((candidate) => candidate.classification === current.classification)) {
      const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === job.uri.toString());
      if (!document) continue;
      const req = reconcileLabels(previous.requirements, current.requirements, job.requirements.map((label) => label.label));
      const ob = reconcileLabels(previous.obligations, current.obligations, job.obligations.map((label) => label.label));
      if (req.error || ob.error) { this.reportMappingAmbiguity(undefined, job, req.error ?? ob.error ?? "ambiguous mapping"); continue; }
      const headerEnd = toRange(job.bodyRange).start;
      updates.push({ uri: job.uri, range: new vscode.Range(toRange(job.range).start, headerEnd), text: `job ${job.rawClassification ?? job.classification ?? ""}(${(req.labels ?? []).join(", ")})${(ob.labels ?? []).length ? ` -> ${(ob.labels ?? []).join(", ")}` : ""}:\n` });
      await this.offerCollaborationInsertion(job, previous, current, req.labels ?? [], ob.labels ?? []);
    }
    await this.applyEdits(updates);
  }

  private async offerCollaborationInsertion(job: Job, oldContract: ContractRecord, contract: ContractRecord, requirements: string[], obligations: string[]): Promise<void> {
    const additions: Array<{ topic: Topic; label: string; role: "join" | "host" }> = [];
    contract.requirements.forEach((topic, index) => { if (!oldContract.requirements.some((old) => topicKey(old) === topicKey(topic)) && topic.type === "abstraction" && typeof topic.protocol === "string") additions.push({ topic, label: requirements[index], role: "join" }); });
    contract.obligations.forEach((topic, index) => { if (!oldContract.obligations.some((old) => topicKey(old) === topicKey(topic)) && topic.type === "abstraction" && typeof topic.protocol === "string") additions.push({ topic, label: obligations[index], role: "host" }); });
    for (const addition of additions) {
      const protocol = this.resolvedProtocol(addition.topic.protocol!);
      const role = protocol && protocol.kind === "managed" ? protocolRole(protocol, addition.role) : undefined;
      const self = role && protocol ? findSelf(addition.role === "join" ? role.requirements : role.obligations, protocol.classification) : { error: "unresolved, legacy-only, or invalid managed protocol" };
      if (!protocol || protocol.kind !== "managed" || !role || self.error) continue;
      const choice = await vscode.window.showInformationMessage(`Component Manager: add ${addition.role} for new collaboration ${addition.topic.protocol}?`, "Insert", "Not now");
      if (choice !== "Insert") continue;
      const topics = addition.role === "join" ? role.requirements : role.obligations;
      const occupied = new Set<string>();
      const labels = uniqueLabels(topics, occupied, addition.label, self.index);
      const requirementsForStatement = addition.role === "join" ? labels : uniqueLabels(role.requirements, new Set());
      const obligationsForStatement = addition.role === "host" ? labels : uniqueLabels(role.obligations, new Set());
      const inserted = `${addition.role} ${protocol.classification}(${requirementsForStatement.join(", ")})${obligationsForStatement.length ? ` -> ${obligationsForStatement.join(", ")}` : ""}\n`;
      const insertion = toRange(job.bodyRange).start;
      await this.applyEdits([{ uri: job.uri, range: new vscode.Range(insertion, insertion), text: inserted }]);
    }
  }

  private reportMappingAmbiguity(protocol: ProtocolRecord | undefined, job: Job, message: string): void {
    const diagnostic = new vscode.Diagnostic(toRange(job.range), `Component Manager stopped synchronisation: ${message}`, vscode.DiagnosticSeverity.Error);
    diagnostic.source = MANAGER_SOURCE;
    diagnostic.relatedInformation = protocol ? [new vscode.DiagnosticRelatedInformation(new vscode.Location(protocol.uri, new vscode.Range(0, 0, 0, 1)), "Changed protocol source")] : undefined;
    this.diagnosticCollection.set(job.uri, [...(this.diagnosticCollection.get(job.uri) ?? []), diagnostic]);
  }

  private statementDiagnostics(uri: vscode.Uri, range: SourceRef["range"]): ExpressionDiagnostic[] {
    if (!range) return [];
    const statementRange = toRange(range);
    const diagnostics = vscode.languages.getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source?.toLowerCase() === "emergent")
      .filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error || diagnostic.severity === vscode.DiagnosticSeverity.Warning)
      .filter((diagnostic) => diagnostic.range.intersection(statementRange))
      .map((diagnostic) => ({
        message: diagnostic.message,
        severity: diagnostic.severity === vscode.DiagnosticSeverity.Error ? "error" as const : "warning" as const,
      }));
    return diagnostics.filter((diagnostic, index) => diagnostics.findIndex((candidate) => candidate.message === diagnostic.message && candidate.severity === diagnostic.severity) === index);
  }

  private async applyEdits(updates: Array<{ uri: vscode.Uri; range: vscode.Range; text: string }>): Promise<void> {
    if (!updates.length) return;
    const edit = new vscode.WorkspaceEdit();
    // Reverse source order per file so parser ranges remain valid during this edit.
    updates.sort((a, b) => b.range.start.compareTo(a.range.start));
    updates.forEach((update) => edit.replace(update.uri, update.range, update.text));
    await vscode.workspace.applyEdit(edit);
  }

  private async openGraph(classification?: string): Promise<void> {
    this.selectedProtocol = classification ?? this.protocols()[0]?.classification;
    if (!this.selectedProtocol) { void vscode.window.showInformationMessage("Component Manager has no indexed protocols."); return; }
    if (!this.graphPanel) {
      this.graphPanel = vscode.window.createWebviewPanel("emergentComponentManager", "Component Manager", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")] });
      this.graphPanel.onDidDispose(() => { this.graphPanel = undefined; });
      this.graphPanel.webview.onDidReceiveMessage((message: any) => {
        // The initial postMessage can race React's listener registration. The
        // shared webview bundle reports ready after that listener is attached,
        // so use it as the reliable graph-state handshake.
        if (message?.type === "ready") this.postGraph();
        if (message?.type === "componentManagerOpenSource") void this.openSource(message.source);
      });
      this.graphPanel.webview.html = this.graphHtml(this.graphPanel.webview);
    }
    this.graphPanel.title = `Component Manager: ${this.selectedProtocol}`;
    this.graphPanel.reveal(vscode.ViewColumn.Active);
    this.postGraph();
  }
  private postGraph(): void {
    if (!this.graphPanel || !this.selectedProtocol) return;
    const protocol = this.resolvedProtocol(this.selectedProtocol);
    const selfMapping = graphSelfSlots(protocol);
    const graphJobs: ProjectionJobInput[] = this.snapshot.jobs.map((job) => {
      const contracts = job.classification ? this.snapshot.contracts.get(job.classification) ?? [] : [];
      const contract = contracts.length === 1 ? contracts[0] : undefined;
      const headerTopics = (lane: "requirements" | "obligations") => job[lane].map((label, index) => {
        const contractTopic = contract?.[lane][index];
        const displayName = typeof contractTopic?.name === "string" && contractTopic.name.trim() ? contractTopic.name : label.label;
        return {
        id: `${job.key}:${lane}:${index}`,
        expressionLabel: label.label,
        displayName,
        // Contract-source navigation remains intact; jobHeaderSource is the
        // exact parsed label reference used for matching and accessibility.
        source: contract ? (lane === "requirements" ? contract.requirementSources[index] : contract.obligationSources[index]) ?? uriRef(contract.uri) : uriRef(job.uri, label.range),
        jobHeaderSource: uriRef(job.uri, label.range),
        };
      });
      return {
        id: job.key,
        classification: job.classification ?? job.rawClassification ?? "Unresolved job",
        source: uriRef(job.uri, job.range),
        requirements: headerTopics("requirements"),
        obligations: headerTopics("obligations"),
        statements: job.statements.map((statement) => ({
          role: statement.role,
          classification: statement.classification,
          requirements: statement.requirements.map((label) => ({ label: label.label, source: uriRef(job.uri, label.range) })),
          obligations: statement.obligations.map((label) => ({ label: label.label, source: uriRef(job.uri, label.range) })),
          diagnostics: this.statementDiagnostics(job.uri, statement.range),
        })),
      };
    });
    const projection = projectComponentGraph({ classification: this.selectedProtocol, kind: protocol?.kind, source: protocol ? uriRef(protocol.uri) : undefined, selfSlots: selfMapping.slots }, graphJobs);
    void this.graphPanel.webview.postMessage({ type: "componentManagerGraph", selectedProtocol: this.selectedProtocol, protocol: protocol ? { kind: protocol.kind, source: uriRef(protocol.uri), selfMappingUnavailable: selfMapping.unavailable } : undefined, jobs: projection.jobs, counts: projection.counts });
  }
  private graphHtml(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const stylesheet = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"));
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${stylesheet}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
  private async openSource(source: SourceRef): Promise<void> {
    const uri = vscode.Uri.parse(source.uri);
    const extension = path.extname(uri.fsPath).toLowerCase();
    const editorType = extension === ".pdes" ? "protocolDesignEditor" : extension === ".cspec" ? "contractSpecEditor" : extension === ".pspec" ? "protocolSpecEditor" : undefined;
    if (editorType) {
      await vscode.commands.executeCommand("vscode.openWith", uri, editorType, vscode.ViewColumn.Beside);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    if (source.range) { const range = toRange(source.range); editor.selection = new vscode.Selection(range.start, range.end); editor.revealRange(range, vscode.TextEditorRevealType.InCenter); }
  }
}

export function registerComponentManager(context: vscode.ExtensionContext, client: LanguageClient): ComponentManager {
  const manager = new ComponentManager(context, client);
  context.subscriptions.push(manager);
  return manager;
}
