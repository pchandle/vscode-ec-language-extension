import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as os from "os";
import Ajv, { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse as parseJsonc, Node as JsonNode, findNodeAtLocation, parseTree } from "jsonc-parser";
import { findPddForVersion } from "../pddLoader";

type HostMessage =
  | { type: "ready" }
  | {
      type: "updateDoc";
      value: unknown;
    };

type WebviewMessage = {
  type: "pdesState";
  value: unknown | null;
  pdd?: unknown;
  pddPath?: string;
  errors: string[];
  parseError?: string;
  protocolCompletions?: string[];
};

export class PdesEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly validator: Ajv;
  private readonly validateFn;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly schema: any,
    private readonly diagnostics: vscode.DiagnosticCollection
  ) {
    this.validator = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(this.validator);
    this.validateFn = this.validator.compile(this.schema);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const updateWebview = () => {
      const parsed = this.parseDocument(document);
      const validation = this.validateDocument(document, parsed);
      this.diagnostics.set(document.uri, validation.diagnostics);
      const version = parsed.value?.protocolDesignVersion;
      const { match } = typeof version === "number" ? findPddForVersion(this.context, version) : { match: undefined };
      const protocolCompletions = this.loadProtocolCompletions();

      const message: WebviewMessage = {
        type: "pdesState",
        value: parsed.value ?? null,
        pdd: match?.definition,
        pddPath: match?.path,
        errors: validation.messages,
        parseError: parsed.parseError,
        protocolCompletions,
      };
      void webviewPanel.webview.postMessage(message);
    };

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      this.diagnostics.delete(document.uri);
    });

    webviewPanel.webview.onDidReceiveMessage((e: HostMessage) => {
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
      const value = parseJsonc(text);
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

    const pathSegments = (error.instancePath || "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        const index = Number(segment);
        return Number.isInteger(index) && segment === index.toString() ? index : segment;
      });

    if (error.keyword === "required" && error.params && (error.params as any).missingProperty) {
      const missing = (error.params as any).missingProperty;
      pathSegments.push(missing);
    }

    const node = findNodeAtLocation(tree, pathSegments);
    if (node) {
      const start = document.positionAt(node.offset);
      const end = document.positionAt(node.offset + node.length);
      return new vscode.Range(start, end);
    }

    return new vscode.Range(0, 0, 0, 1);
  }

  private async updateTextDocument(document: vscode.TextDocument, value: unknown) {
    const edit = new vscode.WorkspaceEdit();
    const jsonText = JSON.stringify(value ?? {}, null, 2) + "\n";
    const end = document.positionAt(document.getText().length);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), end);
    edit.replace(document.uri, fullRange, jsonText);
    await vscode.workspace.applyEdit(edit);
  }

  private loadProtocolCompletions(): string[] {
    try {
      const cachePath = path.join(os.homedir(), ".emergent", "contractCache.json");
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
          ? Object.keys(data.rootDocument).filter((k) => /^\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/.test(k))
          : [];
      return Array.from(new Set([...fromObjects, ...fromRootDoc]));
    } catch (err: any) {
      console.warn("Failed to read protocol completions", err?.message ?? err);
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
  <title>Protocol Design Editor</title>
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

export function loadPdesSchema(context: vscode.ExtensionContext): any | undefined {
  const schemaPath = path.join(context.extensionPath, "docs", "pdes.schema.json");
  try {
    const contents = fs.readFileSync(schemaPath, "utf8");
    return JSON.parse(contents);
  } catch (err) {
    console.error(`Failed to load pdes schema at ${schemaPath}`, err);
    void vscode.window.showErrorMessage("Unable to load protocol design schema.");
    return undefined;
  }
}
