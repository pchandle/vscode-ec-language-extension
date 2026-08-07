import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parse as parseJsonc, parseTree } from "jsonc-parser";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { findPddForVersion } from "./pddLoader";
import { loadPdesSchema } from "./customEditors/PdesEditorProvider";
import { restoreLosslessIntegerFields } from "./customEditors/losslessIntegerFields";
import { serializeProtocolSpecification } from "./customEditors/protocolSpecSerializer";
import { transformPdesToPspec, PdesDesign } from "./pdes/transform";
import { extensionWithoutDot, isFileType, replaceExtension } from "./fileTypes";

export function registerExportProtocolSpec(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("emergent.exportProtocolSpec", () => {
      void exportActivePdes(context);
    })
  );
}

async function exportActivePdes(context: vscode.ExtensionContext) {
  const { uri, text } = await getActivePdesDocument();
  if (!uri || !text) {
    void vscode.window.showErrorMessage("Open a .pdes file to export a protocol spec.");
    return;
  }

  await exportPdesDocument(context, uri, text);
}

/** Exports a supplied .pdes snapshot, including unsaved custom-editor changes. */
export async function exportPdesDocument(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  text: string
): Promise<void> {

  let parsed: PdesDesign;
  try {
    parsed = parseJsonc(text) as PdesDesign;
    restoreLosslessIntegerFields(text, parsed, parseTree(text) ?? undefined, "protocolDesign");
  } catch (err: any) {
    void vscode.window.showErrorMessage(`Failed to parse .pdes: ${err?.message ?? err}`);
    return;
  }

  const schema = loadPdesSchema(context);
  if (!schema) {
    return;
  }

  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(parsed);
  if (!valid) {
    const messages = (validate.errors || []).map((e) => `${e.instancePath || "/"}: ${e.message}`);
    void vscode.window.showErrorMessage(`.pdes validation failed: ${messages.join("; ")}`);
    return;
  }

  const version = parsed.protocolDesignVersion;
  const { match } = findPddForVersion(context, version);
  if (!match?.definition) {
    void vscode.window.showErrorMessage(`No matching .pdd found for version ${version}.`);
    return;
  }

  const { pspec, errors } = transformPdesToPspec(parsed, match.definition as any);
  if (!pspec || (errors && errors.length)) {
    void vscode.window.showErrorMessage(
      `Failed to transform .pdes: ${(errors || []).map((e) => e.message).join("; ")}`
    );
    return;
  }

  const defaultTarget = replaceExtension(uri.fsPath, "protocolSpecification");
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultTarget),
    filters: { "Protocol Specification": [extensionWithoutDot("protocolSpecification")], JSON: ["json"] },
  });
  if (!saveUri) {
    return;
  }

  const newContent = serializeProtocolSpecification(pspec) + "\n";
  const targetExists = fs.existsSync(saveUri.fsPath);

  if (targetExists) {
    const choice = await vscode.window.showWarningMessage(
      `${path.basename(saveUri.fsPath)} already exists. Review diff before overwriting?`,
      "Review diff",
      "Overwrite",
      "Cancel"
    );
    if (!choice || choice === "Cancel") {
      return;
    }
    if (choice === "Review diff") {
      const tempDoc = await vscode.workspace.openTextDocument({ content: newContent, language: "json" });
      await vscode.commands.executeCommand(
        "vscode.diff",
        tempDoc.uri,
        saveUri,
        `New spec ↔ ${path.basename(saveUri.fsPath)}`
      );
      const confirm = await vscode.window.showInformationMessage(
        `Overwrite ${path.basename(saveUri.fsPath)} with generated spec?`,
        "Yes",
        "No"
      );
      if (confirm !== "Yes") {
        return;
      }
    } else if (choice !== "Overwrite") {
      return;
    }
  }

  await fs.promises.writeFile(saveUri.fsPath, newContent, "utf8");
  void vscode.window.showInformationMessage(`Exported protocol spec to ${saveUri.fsPath}`);
}

async function getActivePdesDocument(): Promise<{ uri?: vscode.Uri; text?: string }> {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && isFileType(activeEditor.document.uri.fsPath, "protocolDesign")) {
    return { uri: activeEditor.document.uri, text: activeEditor.document.getText() };
  }

  const tabGroups = (vscode.window as any).tabGroups;
  const activeTab = tabGroups?.activeTabGroup?.activeTab;
  const tabInput = activeTab?.input;
  const isProtocolDesignEditor = tabInput && tabInput.viewType === "protocolDesignEditor";
  const tabUri = isProtocolDesignEditor ? tabInput.uri : undefined;
  if (tabUri) {
    try {
      const text = await fs.promises.readFile(tabUri.fsPath, "utf8");
      return { uri: tabUri, text };
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to read ${tabUri.fsPath}: ${err}`);
      return {};
    }
  }

  return {};
}
