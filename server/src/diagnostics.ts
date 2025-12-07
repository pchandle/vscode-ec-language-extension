import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseText } from "./lang/parser";
import { resolveProgram } from "./lang/resolver";
import { typeCheckProgram } from "./lang/typeChecker";

export interface DiagnosticSettings {
  maxNumberOfProblems: number;
}

export function collectDiagnostics(
  textDocument: TextDocument,
  settings: DiagnosticSettings,
  contractSpecs?: Record<string, any>,
  defaults?: { layer: string; variation: string; platform: string }
): Diagnostic[] {
  const { program, diagnostics: syntaxDiagnostics } = parseText(textDocument.getText());
  const { diagnostics: resolverDiagnostics } = resolveProgram(program);
  const { diagnostics: typeDiagnostics } = typeCheckProgram(program, { contractSpecs, defaults });
  const combined = [...syntaxDiagnostics, ...resolverDiagnostics, ...typeDiagnostics];
  return combined.slice(0, settings.maxNumberOfProblems).map((diag) => ({
    severity: DiagnosticSeverity.Error,
    range: diag.range,
    message: diag.message,
    source: "emergent",
  }));
}
