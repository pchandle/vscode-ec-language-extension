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

  const touchedStartLine = startLine;
  const touchedEndLine = endLine;

  ({ startLine, endLine } = applyStandaloneIfDelimiterExpansions(document, touchedStartLine, touchedEndLine, startLine, endLine));

  return { startLine, endLine };
}

function applyStandaloneIfDelimiterExpansions(
  document: TextDocument,
  touchedStartLine: number,
  touchedEndLine: number,
  startLine: number,
  endLine: number
): NormalizedFormattingRange {
  // Block 5 range policy stays intentionally narrow:
  // only a few explicit if-header/delimiter cases promote the selection to their nearest owned slice.
  // Rules trigger from the originally touched lines so expansions do not cascade into enclosing-unit behavior.
  let expandedStartLine = startLine;
  let expandedEndLine = endLine;

  expandedStartLine = expandThenHeaderSuffix(document, touchedStartLine, touchedEndLine, expandedStartLine);
  expandedStartLine = expandThenBodyContentPrefix(document, touchedStartLine, touchedEndLine, expandedStartLine);
  expandedStartLine = expandBareEndOwnedSuffix(document, touchedStartLine, touchedEndLine, expandedStartLine);
  expandedStartLine = expandEndArrowContentPrefix(document, touchedStartLine, touchedEndLine, expandedStartLine);
  expandedStartLine = expandElseBodyContentPrefix(document, touchedStartLine, touchedEndLine, expandedStartLine);
  expandedEndLine = expandIfHeaderContentSuffix(document, touchedStartLine, touchedEndLine, expandedEndLine);
  expandedEndLine = expandElseBodyPrefix(document, touchedStartLine, touchedEndLine, expandedEndLine);
  expandedEndLine = expandEndArrowContinuationPrefix(document, touchedStartLine, touchedEndLine, expandedEndLine);

  return { startLine: expandedStartLine, endLine: expandedEndLine };
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

function isThenBoundaryLine(document: TextDocument, line: number): boolean {
  return !isStandaloneLineComment(document, line) && /\bthen\b/.test(getLineText(document, line));
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

function isExpandableIfHeaderContentLine(document: TextDocument, line: number): boolean {
  return !isBlankLine(document, line) && !isStandaloneLineComment(document, line) && !isStandaloneThenLine(document, line);
}

function isExpandableEndArrowContentLine(document: TextDocument, line: number): boolean {
  return !isBlankLine(document, line) && !isStandaloneLineComment(document, line) && !isEndArrowContinuationLine(document, line);
}

function isExpandableElseBodyContentLine(document: TextDocument, line: number): boolean {
  return !isBlankLine(document, line) && !isStandaloneLineComment(document, line) && !isStandaloneElseLine(document, line);
}

function isExpandableThenBodyContentLine(document: TextDocument, line: number): boolean {
  return !isBlankLine(document, line) && !isStandaloneLineComment(document, line) && !isThenBoundaryLine(document, line);
}

function expandThenHeaderSuffix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedStartLine: number): number {
  for (let line = touchedEndLine; line >= touchedStartLine; line--) {
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

function expandThenBodyContentPrefix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedStartLine: number): number {
  for (let line = touchedEndLine; line >= touchedStartLine; line--) {
    if (!isExpandableThenBodyContentLine(document, line)) {
      continue;
    }

    // Only the first then-body content line can claim the nearest `then` boundary line.
    let candidateStartLine: number | null = null;

    for (let previousLine = line - 1; previousLine >= 0; previousLine--) {
      if (isThenBoundaryLine(document, previousLine)) {
        candidateStartLine = previousLine;
        break;
      }

      if (isStandaloneElseLine(document, previousLine) || isStandaloneEndLine(document, previousLine)) {
        break;
      }

      if (isBlankLine(document, previousLine) || isStandaloneLineComment(document, previousLine)) {
        candidateStartLine = previousLine;
        continue;
      }

      candidateStartLine = previousLine;
      break;
    }

    if (candidateStartLine !== null && isThenBoundaryLine(document, candidateStartLine)) {
      expandedStartLine = Math.min(expandedStartLine, candidateStartLine);
    }
  }

  return expandedStartLine;
}

function expandElseBodyContentPrefix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedStartLine: number): number {
  for (let line = touchedEndLine; line >= touchedStartLine; line--) {
    if (!isExpandableElseBodyContentLine(document, line)) {
      continue;
    }

    // Only the first else-body content line can claim the standalone `else` delimiter as its nearest owned boundary.
    let candidateStartLine: number | null = null;

    for (let previousLine = line - 1; previousLine >= 0; previousLine--) {
      if (isStandaloneElseLine(document, previousLine)) {
        candidateStartLine = previousLine;
        break;
      }

      if (isStandaloneEndLine(document, previousLine)) {
        break;
      }

      if (isBlankLine(document, previousLine) || isStandaloneLineComment(document, previousLine)) {
        candidateStartLine = previousLine;
        continue;
      }

      candidateStartLine = previousLine;
      break;
    }

    if (candidateStartLine !== null && isStandaloneElseLine(document, candidateStartLine)) {
      expandedStartLine = Math.min(expandedStartLine, candidateStartLine);
    }
  }

  return expandedStartLine;
}

function expandEndArrowContentPrefix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedStartLine: number): number {
  for (let line = touchedEndLine; line >= touchedStartLine; line--) {
    if (!isExpandableEndArrowContentLine(document, line)) {
      continue;
    }

    // Only the first continuation content line can claim the multiline `end ->` delimiter as its nearest owned boundary.
    // Once another nontrivia continuation content line appears, the selection stays line-bounded.
    let candidateStartLine: number | null = null;

    for (let previousLine = line - 1; previousLine >= 0; previousLine--) {
      if (isEndArrowContinuationLine(document, previousLine)) {
        candidateStartLine = previousLine;
        break;
      }

      if (isStandaloneElseLine(document, previousLine) || isStandaloneEndLine(document, previousLine)) {
        break;
      }

      if (isBlankLine(document, previousLine) || isStandaloneLineComment(document, previousLine)) {
        candidateStartLine = previousLine;
        continue;
      }

      candidateStartLine = previousLine;
      break;
    }

    if (candidateStartLine !== null && isEndArrowContinuationLine(document, candidateStartLine)) {
      expandedStartLine = Math.min(expandedStartLine, candidateStartLine);
    }
  }

  return expandedStartLine;
}

function expandIfHeaderContentSuffix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedEndLine: number): number {
  for (let line = touchedStartLine; line <= touchedEndLine; line++) {
    if (!isExpandableIfHeaderContentLine(document, line)) {
      continue;
    }

    let candidateEndLine: number | null = null;

    for (let nextLine = line + 1; nextLine < document.lineCount; nextLine++) {
      if (isStandaloneElseLine(document, nextLine) || isStandaloneEndLine(document, nextLine)) {
        break;
      }

      if (isStandaloneThenLine(document, nextLine)) {
        candidateEndLine = nextLine;
        break;
      }

      if (isBlankLine(document, nextLine) || isStandaloneLineComment(document, nextLine)) {
        candidateEndLine = nextLine;
        continue;
      }

      candidateEndLine = nextLine;
    }

    if (candidateEndLine !== null && isStandaloneThenLine(document, candidateEndLine)) {
      expandedEndLine = Math.max(expandedEndLine, candidateEndLine);
    }
  }

  return expandedEndLine;
}

function expandBareEndOwnedSuffix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedStartLine: number): number {
  for (let line = touchedEndLine; line >= touchedStartLine; line--) {
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

function expandElseBodyPrefix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedEndLine: number): number {
  for (let line = touchedStartLine; line <= touchedEndLine; line++) {
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

function expandEndArrowContinuationPrefix(document: TextDocument, touchedStartLine: number, touchedEndLine: number, expandedEndLine: number): number {
  for (let line = touchedStartLine; line <= touchedEndLine; line++) {
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
