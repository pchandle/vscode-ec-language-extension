import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { ErrorObject } from "ajv";
import {
  findNodeAtLocation,
  Node as JsonNode,
  parse as parseJsonc,
  parseTree,
  ParseError,
  printParseErrorCode,
} from "jsonc-parser";
import { collectPddSemanticDiagnostics } from "./pddValidation";

type HostMessage =
  | { type: "ready" }
  | {
      type: "updateDoc";
      value: unknown;
    };

type WebviewMessage = {
  type: "pddState";
  value: unknown | null;
  errors: string[];
  parseError?: string;
};

export class PddEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly validator;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly schema: any,
    private readonly diagnostics: vscode.DiagnosticCollection
  ) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    this.validator = ajv.compile(this.schema);
  }

  public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const updateWebview = () => {
      const parsed = this.parseDocument(document);
      const validation = this.validateDocument(document, parsed);
      this.diagnostics.set(document.uri, validation.diagnostics);

      const message: WebviewMessage = {
        type: "pddState",
        value: parsed.value ?? null,
        errors: validation.messages,
        parseError: parsed.parseError,
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
    value?: unknown;
    parseError?: string;
    tree?: JsonNode;
  } {
    const text = document.getText();
    const errors: ParseError[] = [];
    const value = parseJsonc(text, errors);
    const tree = parseTree(text);
    if (errors.length > 0) {
      return { text, value, tree: tree ?? undefined, parseError: printParseErrorCode(errors[0].error) };
    }
    return { text, value, tree: tree ?? undefined };
  }

  private validateDocument(
    document: vscode.TextDocument,
    parseResult: { text: string; value?: unknown; parseError?: string; tree?: JsonNode }
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

    const isValid = this.validator(parseResult.value);
    if (!isValid && Array.isArray(this.validator.errors)) {
      for (const error of this.validator.errors) {
        const message = this.toReadableMessage(error);
        messages.push(message);
        diagnostics.push(
          new vscode.Diagnostic(
            this.rangeForJsonPath(document, parseResult.tree, this.jsonPathSegments(error)),
            message,
            vscode.DiagnosticSeverity.Error
          )
        );
      }
    }

    for (const semantic of collectPddSemanticDiagnostics(parseResult.value)) {
      messages.push(semantic.message);
      diagnostics.push(
        new vscode.Diagnostic(
          this.rangeForJsonPath(document, parseResult.tree, semantic.path),
          semantic.message,
          semantic.severity
        )
      );
    }

    return { diagnostics, messages };
  }

  private toReadableMessage(error: ErrorObject): string {
    const path = error.instancePath || "/";
    return `${path}: ${error.message ?? "Schema validation error"}`;
  }

  private jsonPathSegments(error: ErrorObject): (string | number)[] {
    const pathSegments = (error.instancePath || "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        const index = Number(segment);
        return Number.isInteger(index) && segment === index.toString() ? index : segment;
      });

    if (error.keyword === "required" && error.params && (error.params as any).missingProperty) {
      pathSegments.push((error.params as any).missingProperty);
    }

    return pathSegments;
  }

  private rangeForJsonPath(document: vscode.TextDocument, tree: JsonNode | undefined, path: (string | number)[]) {
    if (!tree) {
      return new vscode.Range(0, 0, 0, 1);
    }
    const node = findNodeAtLocation(tree, path);
    if (!node) {
      return new vscode.Range(0, 0, 0, 1);
    }
    const start = document.positionAt(node.offset);
    const end = document.positionAt(node.offset + node.length);
    return new vscode.Range(start, end);
  }

  private async updateTextDocument(document: vscode.TextDocument, value: unknown) {
    const edit = new vscode.WorkspaceEdit();
    const jsonText = JSON.stringify(value ?? {}, null, 2) + "\n";
    const end = document.positionAt(document.getText().length);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), end);
    edit.replace(document.uri, fullRange, jsonText);
    await vscode.workspace.applyEdit(edit);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"));
    const nonce = this.getNonce();
    const csp = [
      "default-src 'none';",
      "sandbox allow-scripts;",
      `img-src ${webview.cspSource} data:;`,
      `script-src ${webview.cspSource} 'nonce-${nonce}';`,
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
  <title>Protocol Design Definition Editor</title>
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

export function loadPddSchema(context: vscode.ExtensionContext): any | undefined {
  const schemaPath = path.join(context.extensionPath, "media", "pdd.schema.json");
  try {
    const contents = fs.readFileSync(schemaPath, "utf8");
    return JSON.parse(contents);
  } catch (err) {
    console.error(`Failed to load pdd schema at ${schemaPath}`, err);
    void vscode.window.showErrorMessage("Unable to load protocol design definition schema.");
    return undefined;
  }
}
