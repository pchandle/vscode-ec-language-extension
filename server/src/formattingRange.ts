import { Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

export interface NormalizedFormattingRange {
  startLine: number;
  endLine: number;
}

export function normalizeRangeToTouchedLines(
  document: TextDocument,
  range: Range
): NormalizedFormattingRange | null {
  if (document.lineCount === 0) {
    return null;
  }

  const rawStartLine = clampLine(range.start.line, document.lineCount);
  const rawEndLine = clampLine(range.end.line, document.lineCount);
  const rawStartCharacter = Math.max(0, range.start.character);
  const rawEndCharacter = Math.max(0, range.end.character);

  let startLine = rawStartLine;
  if (rawStartLine < rawEndLine && rawStartCharacter >= getLineLength(document, rawStartLine)) {
    startLine = rawStartLine + 1;
  }

  let endLine = rawEndLine;
  if (rawEndCharacter === 0 && rawEndLine > startLine) {
    endLine = rawEndLine - 1;
  }

  if (endLine < startLine) {
    endLine = startLine;
  }

  return { startLine, endLine };
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, lineCount - 1));
}

function getLineLength(document: TextDocument, line: number): number {
  return document.getText(Range.create(line, 0, line + 1, 0)).replace(/\r?\n$/, "").length;
}
