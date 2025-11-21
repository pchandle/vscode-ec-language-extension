import * as vscode from "vscode";

function buildSpacingEdits(document: vscode.TextDocument, startLine: number, endLine: number): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];

  for (let i = startLine; i <= endLine; i++) {
    let text = document.lineAt(i).text;

    // Ignore comment lines
    if (text.match(/^\s*\/\//)) continue;

    // Collapse runs of spaces to a single space after a non-space.
    text = text.replace(/([^^\s])\s{2,}/g, "$1 ");
    // Normalize comma spacing.
    text = text.replace(/\s{0,},\s{0,}/g, ", ");
    // Emergent-specific: normalize spacing around arrow operator.
    text = text.replace(/\s*->\s*/g, " -> ");
    // Trim trailing whitespace.
    text = text.replace(/\s+$/g, "");

    edits.push(vscode.TextEdit.replace(document.lineAt(i).range, text));
  }

  return edits;
}

export class EmergentDocumentFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    console.debug("Formatting 'emergent' document.");
    const edits = buildSpacingEdits(document, 0, document.lineCount - 1);
    return edits.length > 0 ? edits : undefined;
  }
}

export class EmergentDocumentRangeFormatter implements vscode.DocumentRangeFormattingEditProvider {
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    console.debug("Formatting 'emergent' document range.");
    const edits = buildSpacingEdits(document, range.start.line, range.end.line);
    return edits.length > 0 ? edits : undefined;
  }
}
