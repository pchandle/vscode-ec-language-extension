import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import Ajv, { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { findNodeAtLocation, parseTree, Node as JsonNode } from "jsonc-parser";

type WebviewIncomingMessage = { type: "ready" } | { type: "updateDoc"; value: unknown };

type WebviewStateMessage = {
  type: "state";
  schema: unknown;
  value: unknown | null;
  errors: string[];
  parseError?: string;
  contractCompletions?: string[];
};

export class SpecEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly validator: Ajv;
  private readonly validateFn: ValidateFunction;
  private suppressNextUpdateFor = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly schema: AnySchema,
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly expectedType: "supplier" | "protocol"
  ) {
    this.validator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(this.validator);
    this.validateFn = this.validator.compile(this.schema);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const updateWebview = () => {
      const parseResult = this.parseDocument(document);
      const validation = this.validateDocument(document, parseResult);
      this.diagnostics.set(document.uri, validation.diagnostics);
      const contractCompletions = this.loadProtocolCompletions();

      const message: WebviewStateMessage = {
        type: "state",
        schema: this.schema,
        value: parseResult.value ?? null,
        errors: validation.messages,
        parseError: parseResult.parseError,
        contractCompletions,
      };
      void webviewPanel.webview.postMessage(message);
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      const key = document.uri.toString();
      if (this.suppressNextUpdateFor.has(key)) {
        this.suppressNextUpdateFor.delete(key);
        return;
      }
      updateWebview();
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      this.diagnostics.delete(document.uri);
    });

    await this.normalizeOnOpen(document);
    webviewPanel.webview.onDidReceiveMessage((e: WebviewIncomingMessage) => {
      if (e.type === "updateDoc") {
        void this.updateTextDocument(document, e.value);
      } else if (e.type === "ready") {
        updateWebview();
      }
    });

    updateWebview();
  }

  private parseDocument(document: vscode.TextDocument): {
    text: string;
    value?: any;
    parseError?: string;
    tree?: JsonNode;
  } {
    const text = document.getText();
    try {
      const value = JSON.parse(text);
      return { text, value, tree: parseTree(text) ?? undefined };
    } catch (err: any) {
      return { text, parseError: err?.message ?? "Invalid JSON" };
    }
  }

  private validateDocument(
    document: vscode.TextDocument,
    parseResult: { text: string; value?: any; parseError?: string; tree?: JsonNode }
  ): { diagnostics: vscode.Diagnostic[]; messages: string[] } {
    if (parseResult.parseError) {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        parseResult.parseError,
        vscode.DiagnosticSeverity.Error
      );
      return { diagnostics: [diagnostic], messages: [parseResult.parseError] };
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const messages: string[] = [];

    const isValid = this.validateFn(parseResult.value);
    if (!isValid && Array.isArray(this.validateFn.errors)) {
      for (const error of this.validateFn.errors) {
        const message = this.toReadableMessage(error);
        messages.push(message);
        const range = this.rangeForError(document, parseResult.tree, error);
        diagnostics.push(new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error));
      }
    }

    return { diagnostics, messages };
  }

  private toReadableMessage(error: ErrorObject): string {
    const path = error.instancePath || "/";
    return `${path}: ${error.message ?? "Schema validation error"}`;
  }

  private rangeForError(
    document: vscode.TextDocument,
    tree: JsonNode | undefined,
    error: ErrorObject
  ): vscode.Range {
    if (!tree) {
      return new vscode.Range(0, 0, 0, 1);
    }

    const path = this.jsonPathSegments(error);
    const node = findNodeAtLocation(tree, path);
    if (node) {
      const start = document.positionAt(node.offset);
      const end = document.positionAt(node.offset + node.length);
      return new vscode.Range(start, end);
    }

    return new vscode.Range(0, 0, 0, 1);
  }

  private jsonPathSegments(error: ErrorObject): (string | number)[] {
    const segments = (error.instancePath || "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        const index = Number(segment);
        return Number.isInteger(index) && segment === index.toString() ? index : segment;
      });

    if (error.keyword === "required" && error.params && (error.params as any).missingProperty) {
      const missing = (error.params as any).missingProperty;
      segments.push(missing);
    }

    return segments;
  }

  private async updateTextDocument(document: vscode.TextDocument, value: unknown) {
    this.suppressNextUpdateFor.add(document.uri.toString());
    const edit = new vscode.WorkspaceEdit();
    const jsonText = JSON.stringify(value ?? {}, null, 2) + "\n";
    const end = document.positionAt(document.getText().length);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), end);
    edit.replace(document.uri, fullRange, jsonText);
    await vscode.workspace.applyEdit(edit);
  }

  private async normalizeOnOpen(document: vscode.TextDocument) {
    const text = document.getText();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    if (!parsed || parsed.type !== this.expectedType) {
      return;
    }

    if (!this.isNameValid(parsed.name)) {
      return;
    }

    const normalized = this.normalizeSpec(parsed);
    const formatted = JSON.stringify(normalized, null, 2) + "\n";
    if (formatted === text) {
      return;
    }

    const valid = this.validateFn(normalized);
    if (valid) {
      await this.updateTextDocument(document, normalized);
    }
  }

  private normalizeSpec(obj: any) {
    const clone = JSON.parse(JSON.stringify(obj));
    delete clone.suppliers;
    if (Array.isArray(clone.description)) {
      clone.description = clone.description.join("\n");
    }
    if (clone.policy && typeof clone.policy === "string" && /^-?\d+$/.test(clone.policy)) {
      clone.policy = parseInt(clone.policy, 10);
    }
    if (clone.host && typeof clone.host === "object" && Array.isArray(clone.host.macro)) {
      clone.host.macro = clone.host.macro.join("\n");
    }
    if (clone.join && typeof clone.join === "object" && Array.isArray(clone.join.macro)) {
      clone.join.macro = clone.join.macro.join("\n");
    }
    const normalizeNumericFields = (item: any) => {
      if (!item || typeof item !== "object") {
        return;
      }
      const toInt = (value: any) => {
        if (typeof value === "number") {
          return Number.isFinite(value) ? Math.trunc(value) : value;
        }
        if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
          return parseInt(value.trim(), 10);
        }
        return value;
      };

      if (item.type === "string") {
        if (item.length !== undefined) {
          item.length = toInt(item.length);
        }
        if (item.hint !== undefined) {
          item.hint = String(item.hint);
        }
      }
      if (item.type === "integer") {
        if (item.minimum !== undefined) {
          item.minimum = toInt(item.minimum);
        }
        if (item.maximum !== undefined) {
          item.maximum = toInt(item.maximum);
        }
        if (item.hint !== undefined) {
          item.hint = toInt(item.hint);
        }
      }
    };

    const normalizeArray = (arr?: any[]) => {
      if (Array.isArray(arr)) {
        arr.forEach(normalizeNumericFields);
      }
    };

    normalizeArray(clone.requirements);
    normalizeArray(clone.obligations);
    normalizeArray(clone.host?.requirements);
    normalizeArray(clone.host?.obligations);
    normalizeArray(clone.join?.requirements);
    normalizeArray(clone.join?.obligations);

    return clone;
  }

  private isNameValid(name: unknown) {
    if (typeof name !== "string") {
      return false;
    }
    const class4 = /^\/(?:[a-z0-9-]+\/){3}[a-z0-9-]+$/;
    const class5 = /^\/(?:[a-z0-9-]+\/){4}[a-z0-9-]+$/;
    return this.expectedType === "protocol" ? class4.test(name) : class5.test(name);
  }

  private loadProtocolCompletions(): string[] {
    try {
      const cachePath = path.join(require("os").homedir(), ".emergent", "contractCache.json");
      if (!fs.existsSync(cachePath)) {
        return [];
      }
      const raw = fs.readFileSync(cachePath, "utf8");
      const data = JSON.parse(raw);
      const fromObjects: string[] = Array.isArray(data?.protocolCompletionCache)
        ? data.protocolCompletionCache
            .map((item: any) =>
              item?.layer && item?.subject && item?.variation && item?.platform
                ? `/${item.layer}/${item.subject}/${item.variation}/${item.platform}`
                : null
            )
            .filter(Boolean)
        : [];
      const fromRootDoc: string[] =
        data?.rootDocument && typeof data.rootDocument === "object"
          ? Object.keys(data.rootDocument).filter((k) => /^\/(?:[a-z0-9-]+\/){3}[a-z0-9-]+$/.test(k))
          : [];
      return Array.from(new Set([...fromObjects, ...fromRootDoc]));
    } catch (err: any) {
      console.warn("Failed to load contract completions", err?.message ?? err);
      return [];
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const nonce = this.getNonce();
    const csp = [
      "default-src 'none';",
      `img-src ${webview.cspSource} data:;`,
      `script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval';`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `font-src ${webview.cspSource};`,
      `connect-src ${webview.cspSource};`,
    ].join(" ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Specification Editor</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce() {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 32 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join("");
  }
}

export function loadSchema(context: vscode.ExtensionContext, filename: string): AnySchema | undefined {
  const schemaPath = path.join(context.extensionPath, "media", filename);
  try {
    const contents = fs.readFileSync(schemaPath, "utf8");
    return JSON.parse(contents);
  } catch (err) {
    console.error(`Failed to load bundled schema at ${schemaPath}`, err);
    void vscode.window.showErrorMessage(`Unable to load bundled specification schema: ${filename}`);
    return undefined;
  }
}
