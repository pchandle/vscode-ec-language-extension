import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseText } from "./lang/parser";
import { resolveProgram } from "./lang/resolver";

export interface DiagnosticSettings {
  maxNumberOfProblems: number;
}

export function collectDiagnostics(textDocument: TextDocument, settings: DiagnosticSettings): Diagnostic[] {
  const { program, diagnostics: syntaxDiagnostics } = parseText(textDocument.getText());
  const { diagnostics: resolverDiagnostics } = resolveProgram(program);
  const combined = [...syntaxDiagnostics, ...resolverDiagnostics];
  return combined.slice(0, settings.maxNumberOfProblems).map((diag) => ({
    severity: DiagnosticSeverity.Error,
    range: diag.range,
    message: diag.message,
    source: "emergent",
  }));
}
