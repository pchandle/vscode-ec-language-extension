import * as vscode from "vscode";
import { parse } from "jsonc-parser";
import { findPddForVersion } from "./pddLoader";

export function registerPdesVersionCheck(context: vscode.ExtensionContext) {
  const notified = new Set<string>();
  const informedMatch = new Set<string>();

  const parseProtocolDesignVersion = (text: string): number | undefined => {
    try {
      const parsed = parse(text);
      const version = (parsed as any)?.protocolDesignVersion;
      return typeof version === "number" ? version : undefined;
    } catch (err: any) {
      return undefined;
    }
  };

  const checkDocument = async (document: vscode.TextDocument) => {
    if (!document.uri.fsPath.toLowerCase().endsWith(".pdes")) {
      return;
    }

    const version = parseProtocolDesignVersion(document.getText());
    if (typeof version !== "number") {
      return;
    }

    const { match } = findPddForVersion(context, version);
    if (match?.definition) {
      const key = `${document.uri.toString()}::${version}`;
      if (!informedMatch.has(key)) {
        informedMatch.add(key);
        void vscode.window.showInformationMessage(
          `Found protocol design definition (version ${version}) at ${match.path}.`
        );
      }
      return;
    }

    const key = document.uri.toString();
    if (notified.has(key)) {
      return;
    }
    notified.add(key);

    const selection = await vscode.window.showWarningMessage(
      `No protocol design definition (.pdd) is available for version ${version}. Configure a matching .pdd path and try again.`,
      "Open in text editor"
    );
    if (selection === "Open in text editor") {
      void vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
    }
  };

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(checkDocument));
  // Check the currently active document at activation time.
  const activeDoc = vscode.window.activeTextEditor?.document;
  if (activeDoc) {
    void checkDocument(activeDoc);
  }
}
