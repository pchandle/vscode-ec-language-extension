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

  const startLine = clampLine(range.start.line, document.lineCount);
  const rawEndLine = clampLine(range.end.line, document.lineCount);
  const rawEndCharacter = Math.max(0, range.end.character);

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
