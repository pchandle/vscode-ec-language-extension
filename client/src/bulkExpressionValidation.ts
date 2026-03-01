import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

type BulkValidationMode = "autopilot" | "pilot" | "both";
type SessionStatus = "pending" | "skipped" | "resolved";

type WorkspaceDiagnosticRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

type BulkValidationDiagnostic = {
  id: string;
  uri: string;
  message: string;
  source?: string;
  severity?: number;
  range: WorkspaceDiagnosticRange;
  lineText: string;
};

type BulkValidationScanParams = {
  folderUris: string[];
  autopilotExtension: string;
  pilotExtension: string;
  mode: BulkValidationMode;
  maxFiles?: number;
  maxDiagnostics?: number;
  perFileMaxProblems?: number;
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

type SessionFile = {
  uri: string;
  diagnostics: BulkValidationDiagnostic[];
  status: SessionStatus;
};

class SummaryNode {
  constructor(
    readonly label: string,
    readonly description: string,
    readonly status: "running" | "ready"
  ) {}
}

class SegmentNode {
  constructor(readonly key: string, readonly label: string) {}
}

class FileNode {
  constructor(readonly uri: vscode.Uri, readonly status: SessionStatus, readonly parentKey: string) {}
}

type TreeNode = SummaryNode | SegmentNode | FileNode;

const MAX_FILE_DESC_CHARS = 56;
const TREE_ROOT_KEY = "__root__";
const LIVE_DIAGNOSTIC_WAIT_MS = 6000;
const VALIDATION_RETRY_DELAY_MS = 120;
const VALIDATION_RETRY_COUNT = 8;

function ensureExtension(value: string, fallback: string): string {
  const trimmed = (value || fallback).trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizeFolderPath(folder: string): string {
  return folder.trim().replace(/^\.?\/?/, "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function asRelativeWorkspaceFolderPath(folder: vscode.WorkspaceFolder): string {
  return normalizeFolderPath(vscode.workspace.asRelativePath(folder.uri, false));
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

class BulkExpressionValidationProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly treeChildren = new Map<string, TreeNode[]>();
  private readonly segmentCounts = new Map<string, { pending: number; total: number }>();
  private readonly segmentNodeByKey = new Map<string, SegmentNode>();
  private readonly fileNodeByUri = new Map<string, FileNode>();
  private readonly filesByUri = new Map<string, SessionFile>();

  private orderedPendingUris: string[] = [];
  private currentIndex = -1;
  private currentAutopilotExtension = ".dla";
  private isActive = false;
  private isBusy = false;
  private currentScanId = "";
  private progressFilesWithDiagnostics = 0;
  private progressMatchedFiles = 0;

  private loadedFilesCount = 0;
  private totalFilesWithDiagnostics = 0;
  private lastScanSummary = "Run a scan to load files with diagnostics.";

  private readonly disposable: vscode.Disposable;
  private readonly progressDisposable: vscode.Disposable;
  private deferredProgressDisposable: vscode.Disposable | undefined;

  constructor(private readonly client: LanguageClient) {
    this.disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
      void this.handleDocumentSaved(doc);
    });
    this.progressDisposable = new vscode.Disposable(() => {
      this.deferredProgressDisposable?.dispose();
    });
    void this.client
      .onReady()
      .then(() => {
        this.deferredProgressDisposable = this.client.onNotification(
          "emergent/bulkValidationProgress",
          (progress: BulkValidationProgress) => {
            this.handleProgress(progress);
          }
        );
      })
      .catch(() => {
        // If the language client never becomes ready, keep provider alive without progress notifications.
      });
  }

  dispose(): void {
    this.disposable.dispose();
    this.progressDisposable.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element instanceof SummaryNode) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.tooltip = this.lastScanSummary;
      item.iconPath = new vscode.ThemeIcon(element.status === "running" ? "sync~spin" : "pass");
      return item;
    }

    if (element instanceof SegmentNode) {
      const counts = this.segmentCounts.get(element.key) || { pending: 0, total: 0 };
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${counts.total} files`;
      item.tooltip = `Pending files: ${counts.pending}\nTotal files: ${counts.total}`;
      item.iconPath = new vscode.ThemeIcon("folder");
      return item;
    }

    const relative = vscode.workspace.asRelativePath(element.uri, false);
    const normalized = relative.replace(/\\/g, "/");
    const slashIndex = normalized.lastIndexOf("/");
    const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
    const parentPath = slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
    const statusTag = element.status === "resolved" ? "resolved" : element.status === "skipped" ? "skipped" : "pending";

    const item = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.None);
    item.description = `${statusTag} • ${truncateText(parentPath, MAX_FILE_DESC_CHARS)}`;
    item.tooltip = relative;
    item.resourceUri = element.uri;
    item.iconPath =
      element.status === "resolved"
        ? new vscode.ThemeIcon("pass")
        : element.status === "skipped"
        ? new vscode.ThemeIcon("debug-step-over")
        : vscode.ThemeIcon.File;
    item.command = {
      command: "emergent.bulkValidation.openFile",
      title: "Open File",
      arguments: [element.uri.toString()],
    };
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return [this.buildSummaryNode(), ...(this.treeChildren.get(TREE_ROOT_KEY) || [])];
    }
    if (element instanceof SegmentNode) {
      return this.treeChildren.get(element.key) || [];
    }
    return [];
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element instanceof FileNode) {
      return this.segmentNodeByKey.get(element.parentKey);
    }
    if (element instanceof SegmentNode) {
      const raw = element.key.replace(/^segment:/, "");
      const slash = raw.lastIndexOf("/");
      if (slash < 0) return undefined;
      return this.segmentNodeByKey.get(`segment:${raw.slice(0, slash)}`);
    }
    return undefined;
  }

  private buildSummaryNode(): SummaryNode {
    const files = Array.from(this.filesByUri.values());
    const pending = files.filter((f) => f.status === "pending").length;
    const skipped = files.filter((f) => f.status === "skipped").length;
    const resolved = files.filter((f) => f.status === "resolved").length;
    const runState: "running" | "ready" = this.isBusy ? "running" : "ready";
    const runStateLabel = runState === "running" ? "Running" : "Ready";
    const runningProgress =
      runState === "running" ? ` SoFar:${this.progressFilesWithDiagnostics} (${this.progressMatchedFiles} checked)` : "";
    const description = `${runStateLabel} • Files P:${pending} S:${skipped} R:${resolved} Loaded:${this.loadedFilesCount} Found:${this.totalFilesWithDiagnostics}${runningProgress}`;
    return new SummaryNode("Bulk Expression Validation", description, runState);
  }

  private classificationSegmentsFor(relativePath: string): string[] {
    const normalized = relativePath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1] ?? "";
    const fileExt = fileName.includes(".") ? `.${fileName.split(".").pop()}`.toLowerCase() : "";
    if (fileExt === this.currentAutopilotExtension) {
      const parentDirs = parts.slice(0, -1);
      if (parentDirs.length >= 5) {
        return parentDirs.slice(0, 5);
      }
      const baseName = fileName.replace(/\.[^.]+$/, "");
      const tokens = baseName.split("--").filter(Boolean);
      if (tokens.length >= 5) {
        return tokens.slice(0, 5);
      }
      return ["autopilot", "unclassified"];
    }
    return ["other"];
  }

  private ensureChild(parentKey: string, child: TreeNode): void {
    const current = this.treeChildren.get(parentKey) || [];
    const exists = current.some((entry) => {
      if (entry instanceof SegmentNode && child instanceof SegmentNode) {
        return entry.key === child.key;
      }
      if (entry instanceof FileNode && child instanceof FileNode) {
        return entry.uri.toString() === child.uri.toString();
      }
      return false;
    });
    if (!exists) {
      current.push(child);
      this.treeChildren.set(parentKey, current);
    }
    if (child instanceof SegmentNode) {
      this.segmentNodeByKey.set(child.key, child);
      if (!this.treeChildren.has(child.key)) {
        this.treeChildren.set(child.key, []);
      }
    }
    if (child instanceof FileNode) {
      this.fileNodeByUri.set(child.uri.toString(), child);
    }
  }

  private rebuildTree(): void {
    this.treeChildren.clear();
    this.segmentCounts.clear();
    this.segmentNodeByKey.clear();
    this.fileNodeByUri.clear();
    this.treeChildren.set(TREE_ROOT_KEY, []);

    for (const sessionFile of this.filesByUri.values()) {
      const relative = vscode.workspace.asRelativePath(vscode.Uri.parse(sessionFile.uri), false);
      const segments = this.classificationSegmentsFor(relative);
      let parentKey = TREE_ROOT_KEY;
      let pathKey = "";
      for (const segment of segments) {
        pathKey = pathKey ? `${pathKey}/${segment}` : segment;
        const segmentKey = `segment:${pathKey}`;
        const existing = this.segmentCounts.get(segmentKey) || { pending: 0, total: 0 };
        existing.total += 1;
        if (sessionFile.status === "pending") {
          existing.pending += 1;
        }
        this.segmentCounts.set(segmentKey, existing);
        this.ensureChild(parentKey, new SegmentNode(segmentKey, segment));
        parentKey = segmentKey;
      }
      this.ensureChild(parentKey, new FileNode(vscode.Uri.parse(sessionFile.uri), sessionFile.status, parentKey));
    }

    const sortChildren = (key: string) => {
      const children = this.treeChildren.get(key) || [];
      children.sort((a, b) => {
        const aIsSegment = a instanceof SegmentNode;
        const bIsSegment = b instanceof SegmentNode;
        if (aIsSegment && !bIsSegment) return -1;
        if (!aIsSegment && bIsSegment) return 1;
        if (a instanceof SegmentNode && b instanceof SegmentNode) {
          const aCounts = this.segmentCounts.get(a.key) || { pending: 0, total: 0 };
          const bCounts = this.segmentCounts.get(b.key) || { pending: 0, total: 0 };
          if (bCounts.pending !== aCounts.pending) return bCounts.pending - aCounts.pending;
          return a.label.localeCompare(b.label);
        }
        if (a instanceof FileNode && b instanceof FileNode) {
          if (a.status !== b.status) {
            const rank = (status: SessionStatus) => (status === "pending" ? 0 : status === "skipped" ? 1 : 2);
            return rank(a.status) - rank(b.status);
          }
          return a.uri.toString().localeCompare(b.uri.toString());
        }
        return 0;
      });
      this.treeChildren.set(key, children);
      for (const child of children) {
        if (child instanceof SegmentNode) {
          sortChildren(child.key);
        }
      }
    };
    sortChildren(TREE_ROOT_KEY);
  }

  private rebuildPendingOrder(): void {
    this.orderedPendingUris = Array.from(this.filesByUri.values())
      .filter((f) => f.status === "pending")
      .map((f) => f.uri)
      .sort();

    if (this.orderedPendingUris.length === 0) {
      this.currentIndex = -1;
      return;
    }
    if (this.currentIndex < 0) {
      this.currentIndex = 0;
      return;
    }
    if (this.currentIndex >= this.orderedPendingUris.length) {
      this.currentIndex = this.orderedPendingUris.length - 1;
    }
  }

  private setCurrentFromUri(uri: string): void {
    const idx = this.orderedPendingUris.indexOf(uri);
    if (idx >= 0) {
      this.currentIndex = idx;
    }
  }

  async startSession(): Promise<string | undefined> {
    this.isActive = true;
    await this.rescan();
    if (this.orderedPendingUris.length === 0) {
      return undefined;
    }
    const uri = this.orderedPendingUris[0];
    this.currentIndex = 0;
    await this.openFileByUri(uri);
    return uri;
  }

  async rescan(): Promise<void> {
    if (this.isBusy) {
      return;
    }
    this.isBusy = true;
    this.currentScanId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.progressFilesWithDiagnostics = 0;
    this.progressMatchedFiles = 0;
    this.lastScanSummary = "Bulk scan in progress...";
    this.onDidChangeTreeDataEmitter.fire(undefined);
    try {
      await this.client.onReady();
      const params = this.buildScanParams();
      const started = Date.now();
      const response = (await this.client.sendRequest("emergent/findWorkspaceDiagnostics", {
        ...params,
        scanId: this.currentScanId,
      })) as BulkValidationScanResult;
      this.applyScanResult(response, Date.now() - started);
      if (response.warnings.length > 0) {
        void vscode.window.showWarningMessage(response.warnings[0]);
      }
    } catch (err: any) {
      this.lastScanSummary = `Bulk scan failed: ${err?.message ?? err}`;
      void vscode.window.showErrorMessage(`Bulk Expression Validation scan failed: ${err?.message ?? err}`);
    } finally {
      this.isBusy = false;
      this.currentScanId = "";
      this.onDidChangeTreeDataEmitter.fire(undefined);
    }
  }

  async nextFile(): Promise<string | undefined> {
    if (this.orderedPendingUris.length === 0) {
      void vscode.window.showInformationMessage("No pending files in Bulk Expression Validation session.");
      return undefined;
    }
    this.currentIndex = this.currentIndex < 0 ? 0 : Math.min(this.currentIndex + 1, this.orderedPendingUris.length - 1);
    while (this.orderedPendingUris.length > 0) {
      const uri = this.orderedPendingUris[this.currentIndex];
      await this.openFileByUri(uri);
      if (this.filesByUri.has(uri)) {
        return uri;
      }
      if (this.currentIndex >= this.orderedPendingUris.length) {
        this.currentIndex = this.orderedPendingUris.length - 1;
      }
    }
    return undefined;
  }

  async previousFile(): Promise<string | undefined> {
    if (this.orderedPendingUris.length === 0) {
      void vscode.window.showInformationMessage("No pending files in Bulk Expression Validation session.");
      return undefined;
    }
    this.currentIndex = this.currentIndex <= 0 ? 0 : this.currentIndex - 1;
    while (this.orderedPendingUris.length > 0) {
      const uri = this.orderedPendingUris[this.currentIndex];
      await this.openFileByUri(uri);
      if (this.filesByUri.has(uri)) {
        return uri;
      }
      if (this.currentIndex >= this.orderedPendingUris.length) {
        this.currentIndex = this.orderedPendingUris.length - 1;
      }
      if (this.currentIndex < 0) {
        this.currentIndex = 0;
      }
    }
    return undefined;
  }

  async skipCurrentFile(): Promise<string | undefined> {
    const current = this.currentPendingFile();
    if (!current) {
      void vscode.window.showInformationMessage("No current file to skip.");
      return undefined;
    }
    current.status = "skipped";
    this.rebuildPendingOrder();
    this.rebuildTree();
    this.onDidChangeTreeDataEmitter.fire(undefined);
    if (this.orderedPendingUris.length === 0) {
      return undefined;
    }
    const uri = this.orderedPendingUris[Math.min(this.currentIndex, this.orderedPendingUris.length - 1)];
    await this.openFileByUri(uri);
    return uri;
  }

  clearSession(): void {
    this.isActive = false;
    this.filesByUri.clear();
    this.orderedPendingUris = [];
    this.currentIndex = -1;
    this.loadedFilesCount = 0;
    this.totalFilesWithDiagnostics = 0;
    this.lastScanSummary = "Run a scan to load files with diagnostics.";
    this.treeChildren.clear();
    this.segmentCounts.clear();
    this.segmentNodeByKey.clear();
    this.fileNodeByUri.clear();
    this.treeChildren.set(TREE_ROOT_KEY, []);
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async openFileByUri(uriText: string): Promise<void> {
    this.setCurrentFromUri(uriText);
    const uri = vscode.Uri.parse(uriText);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const file = this.filesByUri.get(uriText);
    const first = file?.diagnostics[0];
    if (first) {
      const range = new vscode.Range(
        new vscode.Position(first.range.start.line, first.range.start.character),
        new vscode.Position(first.range.end.line, first.range.end.character)
      );
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
    await this.waitForLiveDiagnostics(uri, true);
    this.syncFileFromLiveDiagnostics(uriText);
  }

  private currentPendingFile(): SessionFile | undefined {
    if (this.currentIndex < 0 || this.currentIndex >= this.orderedPendingUris.length) {
      return undefined;
    }
    return this.filesByUri.get(this.orderedPendingUris[this.currentIndex]);
  }

  private buildScanParams(): BulkValidationScanParams {
    const cfg = vscode.workspace.getConfiguration("emergent");
    const autopilotExtension = ensureExtension(cfg.get<string>("autopilotExtension", ".dla"), ".dla");
    const pilotExtension = ensureExtension(cfg.get<string>("pilotExtension", ".dlp"), ".dlp");
    this.currentAutopilotExtension = autopilotExtension.toLowerCase();
    const mode = cfg.get<BulkValidationMode>("bulkValidationMode", "autopilot");
    const selectedFolders = cfg.get<string[]>("bulkValidationFolders", []);

    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    if (workspaceFolders.length === 0) {
      void vscode.window.showWarningMessage("Open a workspace folder to run Bulk Expression Validation.");
    }

    const selectedSet = new Set(selectedFolders.map((folder) => normalizeFolderPath(folder)).filter(Boolean));
    const resolvedFolderUris =
      selectedSet.size === 0
        ? workspaceFolders.map((folder) => folder.uri.toString())
        : workspaceFolders
            .filter((folder) => selectedSet.has(asRelativeWorkspaceFolderPath(folder)))
            .map((folder) => folder.uri.toString());

    if (selectedSet.size > 0 && resolvedFolderUris.length === 0) {
      void vscode.window.showWarningMessage(
        "No entries in emergent.bulkValidationFolders matched workspace folder relative paths. Scanning all folders instead."
      );
      return {
        folderUris: workspaceFolders.map((folder) => folder.uri.toString()),
        autopilotExtension,
        pilotExtension,
        mode,
        perFileMaxProblems: cfg.get<number>("maxNumberOfProblems", 100) ?? 100,
      };
    }

    return {
      folderUris: resolvedFolderUris,
      autopilotExtension,
      pilotExtension,
      mode,
      perFileMaxProblems: cfg.get<number>("maxNumberOfProblems", 100) ?? 100,
    };
  }

  private applyScanResult(result: BulkValidationScanResult, elapsedMs: number): void {
    const previousStatus = new Map<string, SessionStatus>();
    for (const file of this.filesByUri.values()) {
      previousStatus.set(file.uri, file.status);
    }

    const grouped = new Map<string, BulkValidationDiagnostic[]>();
    for (const item of result.items) {
      const list = grouped.get(item.uri) || [];
      list.push(item);
      grouped.set(item.uri, list);
    }

    this.filesByUri.clear();
    for (const [uri, diagnostics] of grouped.entries()) {
      const existing = previousStatus.get(uri);
      this.filesByUri.set(uri, {
        uri,
        diagnostics,
        status: existing ?? "pending",
      });
    }

    this.loadedFilesCount = this.filesByUri.size;
    this.totalFilesWithDiagnostics = result.totalFilesWithDiagnostics;
    this.rebuildPendingOrder();
    this.rebuildTree();
    this.lastScanSummary = `${result.totalFilesWithDiagnostics} files with diagnostics found, ${this.loadedFilesCount} files loaded in ${elapsedMs}ms${
      result.truncated ? " (load limit reached)" : ""
    }`;
  }

  private async handleDocumentSaved(document: vscode.TextDocument): Promise<void> {
    if (!this.isActive) {
      return;
    }
    const current = this.currentPendingFile();
    if (!current || current.uri !== document.uri.toString()) {
      return;
    }

    const diagnostics = vscode.languages.getDiagnostics(document.uri).filter((diag) => {
      if (diag.source && diag.source.toLowerCase() !== "emergent") {
        return false;
      }
      return true;
    });

    if (diagnostics.length === 0) {
      this.filesByUri.delete(current.uri);
      this.rebuildPendingOrder();
      this.rebuildTree();
      this.loadedFilesCount = this.filesByUri.size;
      this.onDidChangeTreeDataEmitter.fire(undefined);
      if (this.orderedPendingUris.length > 0) {
        const nextUri = this.orderedPendingUris[Math.min(this.currentIndex, this.orderedPendingUris.length - 1)];
        await this.openFileByUri(nextUri);
      }
    }
  }

  private async waitForLiveDiagnostics(uri: vscode.Uri, clearOthers: boolean): Promise<void> {
    const uriText = uri.toString();
    const waitForDiagnostics = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        subscription.dispose();
        resolve();
      }, LIVE_DIAGNOSTIC_WAIT_MS);
      const subscription = vscode.languages.onDidChangeDiagnostics((event) => {
        if (event.uris.some((changedUri) => changedUri.toString() === uriText)) {
          clearTimeout(timeout);
          subscription.dispose();
          resolve();
        }
      });
    });

    try {
      let validated = false;
      for (let attempt = 0; attempt < VALIDATION_RETRY_COUNT; attempt++) {
        validated = await this.client.sendRequest<boolean>("emergent/validateDocument", { uri: uriText, clearOthers });
        if (validated) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, VALIDATION_RETRY_DELAY_MS));
      }
    } catch {
      // Fall back to normal background validation.
    }

    await waitForDiagnostics;
  }

  async revealFileLeaf(tree: vscode.TreeView<TreeNode>, uri: string): Promise<void> {
    const node = this.fileNodeByUri.get(uri);
    if (!node) {
      return;
    }
    try {
      await tree.reveal(node, { focus: true, select: true, expand: 8 });
    } catch {
      // Ignore reveal failures; file navigation has already completed.
    }
  }

  private syncFileFromLiveDiagnostics(uriText: string): void {
    const uri = vscode.Uri.parse(uriText);
    const diagnostics = vscode.languages.getDiagnostics(uri).filter((diag) => {
      if (diag.source && diag.source.toLowerCase() !== "emergent") {
        return false;
      }
      return true;
    });
    if (diagnostics.length > 0) {
      return;
    }
    if (!this.filesByUri.has(uriText)) {
      return;
    }
    this.filesByUri.delete(uriText);
    this.rebuildPendingOrder();
    this.rebuildTree();
    this.loadedFilesCount = this.filesByUri.size;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  private handleProgress(progress: BulkValidationProgress): void {
    if (!this.isBusy || !this.currentScanId || progress.scanId !== this.currentScanId) {
      return;
    }
    this.progressFilesWithDiagnostics = progress.filesWithDiagnostics;
    this.progressMatchedFiles = progress.matchedFiles;
    this.lastScanSummary = `Scanning... ${progress.filesWithDiagnostics} files with diagnostics so far (${progress.matchedFiles} files checked)`;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
}

export function registerBulkExpressionValidation(context: vscode.ExtensionContext, client: LanguageClient): void {
  const provider = new BulkExpressionValidationProvider(client);
  const tree = vscode.window.createTreeView("emergent.bulkExpressionValidation", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(provider, tree);

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.startBulkExpressionValidation", async () => {
      const uri = await provider.startSession();
      if (uri) {
        await provider.revealFileLeaf(tree, uri);
      } else {
        await vscode.commands.executeCommand("emergent.bulkExpressionValidation.focus");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.rescanBulkExpressionValidation", async () => {
      await provider.rescan();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.nextBulkExpressionDiagnostic", async () => {
      const uri = await provider.nextFile();
      if (uri) {
        await provider.revealFileLeaf(tree, uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.previousBulkExpressionDiagnostic", async () => {
      const uri = await provider.previousFile();
      if (uri) {
        await provider.revealFileLeaf(tree, uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.skipBulkExpressionDiagnostic", async () => {
      const uri = await provider.skipCurrentFile();
      if (uri) {
        await provider.revealFileLeaf(tree, uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.clearBulkExpressionValidation", () => {
      provider.clearSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.bulkValidation.openFile", async (uri: string) => {
      await provider.openFileByUri(uri);
      await provider.revealFileLeaf(tree, uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.focusBulkExpressionValidation", async () => {
      await vscode.commands.executeCommand("emergent.bulkExpressionValidation.focus");
    })
  );
}
