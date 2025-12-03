import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseText } from "./lang/parser";

export interface DiagnosticSettings {
  maxNumberOfProblems: number;
}

export function collectDiagnostics(textDocument: TextDocument, settings: DiagnosticSettings): Diagnostic[] {
  const { diagnostics } = parseText(textDocument.getText());
  return diagnostics.slice(0, settings.maxNumberOfProblems).map((diag) => ({
    severity: DiagnosticSeverity.Error,
    range: diag.range,
    message: diag.message,
    source: "emergent",
  }));
}
