import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

export interface DiagnosticSettings {
  maxNumberOfProblems: number;
}

const UPPERCASE_PATTERN = /\b[A-Z]{2,}\b/g;

export function collectDiagnostics(textDocument: TextDocument, settings: DiagnosticSettings): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const text = textDocument.getText();
  UPPERCASE_PATTERN.lastIndex = 0;

  let problems = 0;
  let match: RegExpExecArray | null;
  while ((match = UPPERCASE_PATTERN.exec(text)) && problems < settings.maxNumberOfProblems) {
    const range = {
      start: textDocument.positionAt(match.index),
      end: textDocument.positionAt(match.index + match[0].length),
    };
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range,
      message: `${match[0]} is all uppercase.`,
      source: "emergent",
    });
    problems++;
  }

  return diagnostics;
}
