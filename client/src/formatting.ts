import * as vscode from "vscode";
import { TextDocumentEdit } from 'vscode-languageclient';

export class EmergentDocumentFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken)
    : vscode.ProviderResult<vscode.TextEdit[]> {
    console.debug("Formatting 'emergent' document.");
    const edits=[];
    let newline="";
    for (let i = 0; i < document.lineCount; i++) {
      newline=document.lineAt(i).text;
      // Ignore comment lines
      if (newline.match(/^\s*\/\//)) continue;

      newline=newline.replace(/([^^\s])\s{2,}/g,"$1 ");
      newline=newline.replace(/\s{0,},\s{0,}/g,", ");

      
      edits.push(vscode.TextEdit.replace(document.lineAt(i).range, newline));
    }

    if (edits.length > 0) {
      return edits;
    }
  }
}

export class EmergentDocumentRangeFormatter implements vscode.DocumentRangeFormattingEditProvider {
  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument, range: vscode.Range,
        options: vscode.FormattingOptions, token: vscode.CancellationToken)
    : vscode.ProviderResult<vscode.TextEdit[]> {
    console.debug("Formatting 'emergent' document range.");
    const firstLine = document.lineAt(0);
    if (!firstLine) {
      return [vscode.TextEdit.insert(firstLine.range.start, "42\n")];
    }
  }
}
