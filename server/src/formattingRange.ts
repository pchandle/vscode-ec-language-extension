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

  startLine = expandThenHeaderSuffix(document, startLine, endLine);
  startLine = expandBareEndOwnedSuffix(document, startLine, endLine);
  endLine = expandElseBodyPrefix(document, startLine, endLine);
  endLine = expandEndArrowContinuationPrefix(document, startLine, endLine);

  return { startLine, endLine };
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, lineCount - 1));
}

function getLineLength(document: TextDocument, line: number): number {
  return document.getText(Range.create(line, 0, line + 1, 0)).replace(/\r?\n$/, "").length;
}

function getLineText(document: TextDocument, line: number): string {
  return document.getText(Range.create(line, 0, line + 1, 0)).replace(/\r?\n$/, "");
}

function isBlankLine(document: TextDocument, line: number): boolean {
  return getLineText(document, line).trim().length === 0;
}

function isStandaloneLineComment(document: TextDocument, line: number): boolean {
  return /^\s*\/\//.test(getLineText(document, line));
}

function isStandaloneElseLine(document: TextDocument, line: number): boolean {
  return getLineText(document, line).trim() === "else";
}

function isStandaloneThenLine(document: TextDocument, line: number): boolean {
  return getLineText(document, line).trim() === "then";
}

function isStandaloneEndLine(document: TextDocument, line: number): boolean {
  return /^end(\s|$)/.test(getLineText(document, line).trim());
}

function isBareEndLine(document: TextDocument, line: number): boolean {
  return getLineText(document, line).trim() === "end";
}

function isEndArrowContinuationLine(document: TextDocument, line: number): boolean {
  const trimmed = getLineText(document, line).trim();
  return /^end\s*->/.test(trimmed) && (/,\s*$/.test(trimmed) || /->\s*$/.test(trimmed));
}

function expandThenHeaderSuffix(document: TextDocument, startLine: number, endLine: number): number {
  let expandedStartLine = startLine;

  for (let line = endLine; line >= expandedStartLine; line--) {
    if (!isStandaloneThenLine(document, line)) {
      continue;
    }

    for (let previousLine = line - 1; previousLine >= 0; previousLine--) {
      if (isStandaloneElseLine(document, previousLine) || isStandaloneEndLine(document, previousLine)) {
        break;
      }

      expandedStartLine = Math.min(expandedStartLine, previousLine);

      if (isBlankLine(document, previousLine) || isStandaloneLineComment(document, previousLine)) {
        continue;
      }

      break;
    }
  }

  return expandedStartLine;
}

function expandBareEndOwnedSuffix(document: TextDocument, startLine: number, endLine: number): number {
  let expandedStartLine = startLine;

  for (let line = endLine; line >= expandedStartLine; line--) {
    if (!isBareEndLine(document, line)) {
      continue;
    }

    for (let previousLine = line - 1; previousLine >= 0; previousLine--) {
      if (isStandaloneElseLine(document, previousLine) || isStandaloneEndLine(document, previousLine)) {
        break;
      }

      expandedStartLine = Math.min(expandedStartLine, previousLine);

      if (isBlankLine(document, previousLine) || isStandaloneLineComment(document, previousLine)) {
        continue;
      }

      break;
    }
  }

  return expandedStartLine;
}

function expandElseBodyPrefix(document: TextDocument, startLine: number, endLine: number): number {
  let expandedEndLine = endLine;

  for (let line = startLine; line <= expandedEndLine; line++) {
    if (!isStandaloneElseLine(document, line)) {
      continue;
    }

    for (let nextLine = line + 1; nextLine < document.lineCount; nextLine++) {
      if (isStandaloneEndLine(document, nextLine)) {
        break;
      }

      expandedEndLine = Math.max(expandedEndLine, nextLine);

      if (isBlankLine(document, nextLine) || isStandaloneLineComment(document, nextLine)) {
        continue;
      }

      break;
    }
  }

  return expandedEndLine;
}

function expandEndArrowContinuationPrefix(document: TextDocument, startLine: number, endLine: number): number {
  let expandedEndLine = endLine;

  for (let line = startLine; line <= expandedEndLine; line++) {
    if (!isEndArrowContinuationLine(document, line)) {
      continue;
    }

    for (let nextLine = line + 1; nextLine < document.lineCount; nextLine++) {
      if (isStandaloneEndLine(document, nextLine)) {
        break;
      }

      expandedEndLine = Math.max(expandedEndLine, nextLine);

      if (isBlankLine(document, nextLine) || isStandaloneLineComment(document, nextLine)) {
        continue;
      }

      break;
    }
  }

  return expandedEndLine;
}
