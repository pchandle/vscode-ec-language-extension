import { Position, Range, TextEdit } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { NodeKind, ProgramNode, Statement } from "./lang/ast";
import { lexText } from "./lang/lexer";
import { parseText } from "./lang/parser";
import { SyntaxDiagnostic, Token, TokenKind } from "./lang/tokens";

export type FormattingParseMode = "parsed" | "recovery";
export type FormattingLineKind = "blank" | "comment" | "content";

export interface FormattingLine {
  lineIndex: number;
  originalText: string;
  kind: FormattingLineKind;
  coveredBySyntax: boolean;
  intersectsDiagnostic: boolean;
  protectedRanges: FormattingCharacterRange[];
  safeToFormat: boolean;
}

export interface FormattingCharacterRange {
  startCharacter: number;
  endCharacter: number;
}

export interface FormattingInput {
  document: TextDocument;
  program: ProgramNode;
  syntaxDiagnostics: SyntaxDiagnostic[];
  parseMode: FormattingParseMode;
  lines: FormattingLine[];
}

export interface FormattingRequest {
  startLine: number;
  endLine: number;
}

export interface FormattingDecision {
  lineIndex: number;
  originalText: string;
  formattedText: string;
  kind: FormattingLineKind;
  parseMode: FormattingParseMode;
  coveredBySyntax: boolean;
  safeToFormat: boolean;
}

function formatLine(text: string): string {
  if (text.match(/^\s*\/\//)) {
    return text;
  }

  let formatted = text;
  formatted = formatted.replace(/([^^\s])\s{2,}/g, "$1 ");
  formatted = formatted.replace(/\s{0,},\s{0,}/g, ", ");
  formatted = formatted.replace(/\s*->\s*/g, " -> ");
  formatted = formatted.replace(/\s+$/g, "");
  return formatted;
}

function classifyLine(text: string): FormattingLineKind {
  if (/^\s*\/\//.test(text)) {
    return "comment";
  }
  if (text.trim().length === 0) {
    return "blank";
  }
  return "content";
}

function addRangeLines(lines: Set<number>, range: Range): void {
  for (let line = range.start.line; line <= range.end.line; line++) {
    lines.add(line);
  }
}

function collectDiagnosticLines(diagnostics: SyntaxDiagnostic[]): Set<number> {
  const lines = new Set<number>();
  for (const diagnostic of diagnostics) {
    addRangeLines(lines, diagnostic.range);
  }
  return lines;
}

function clampCharacter(value: number, lineLength: number): number {
  return Math.max(0, Math.min(value, lineLength));
}

function collectDiagnosticCharacterRangesForDiagnostic(
  document: TextDocument,
  diagnostic: SyntaxDiagnostic
): FormattingCharacterRange[] {
  const ranges: FormattingCharacterRange[] = [];

  for (let lineIndex = diagnostic.range.start.line; lineIndex <= diagnostic.range.end.line; lineIndex++) {
    const lineLength = getLineText(document, lineIndex).length;
    const startCharacter =
      lineIndex === diagnostic.range.start.line
        ? clampCharacter(diagnostic.range.start.character, lineLength)
        : 0;
    const endCharacter =
      lineIndex === diagnostic.range.start.line && diagnostic.range.start.line !== diagnostic.range.end.line
        ? lineLength
        : lineIndex === diagnostic.range.end.line
          ? clampCharacter(diagnostic.range.end.character, lineLength)
          : lineLength;
    ranges.push({ startCharacter, endCharacter });
  }

  return ranges;
}

function tokenIntersectsDiagnostic(token: Token, diagnostic: SyntaxDiagnostic): boolean {
  if (token.kind === TokenKind.Newline || token.kind === TokenKind.EOF) {
    return false;
  }

  const startsBeforeDiagnosticEnds =
    token.range.start.line < diagnostic.range.end.line ||
    (token.range.start.line === diagnostic.range.end.line &&
      token.range.start.character < diagnostic.range.end.character);
  const endsAfterDiagnosticStarts =
    token.range.end.line > diagnostic.range.start.line ||
    (token.range.end.line === diagnostic.range.start.line &&
      token.range.end.character > diagnostic.range.start.character);

  return startsBeforeDiagnosticEnds && endsAfterDiagnosticStarts;
}

function addProtectedRange(
  protectedRanges: Map<number, FormattingCharacterRange[]>,
  lineIndex: number,
  startCharacter: number,
  endCharacter: number
): void {
  const ranges = protectedRanges.get(lineIndex) ?? [];
  ranges.push({ startCharacter, endCharacter });
  protectedRanges.set(lineIndex, ranges);
}

function collectProtectedRanges(
  document: TextDocument,
  tokens: Token[],
  diagnostics: SyntaxDiagnostic[]
): Map<number, FormattingCharacterRange[]> {
  const protectedRanges = new Map<number, FormattingCharacterRange[]>();

  for (const diagnostic of diagnostics) {
    const overlappingTokens = tokens.filter((token) => tokenIntersectsDiagnostic(token, diagnostic));

    if (overlappingTokens.length > 0) {
      for (const token of overlappingTokens) {
        for (let lineIndex = token.range.start.line; lineIndex <= token.range.end.line; lineIndex++) {
          const lineLength = getLineText(document, lineIndex).length;
          const startCharacter = lineIndex === token.range.start.line ? clampCharacter(token.range.start.character, lineLength) : 0;
          const endCharacter = lineIndex === token.range.end.line ? clampCharacter(token.range.end.character, lineLength) : lineLength;
          addProtectedRange(protectedRanges, lineIndex, startCharacter, endCharacter);
        }
      }
      continue;
    }

    const fallbackRanges = collectDiagnosticCharacterRangesForDiagnostic(document, diagnostic);
    fallbackRanges.forEach((range, index) => {
      addProtectedRange(
        protectedRanges,
        diagnostic.range.start.line + index,
        range.startCharacter,
        range.endCharacter
      );
    });
  }

  return protectedRanges;
}

function mergeCharacterRanges(ranges: FormattingCharacterRange[]): FormattingCharacterRange[] {
  if (ranges.length <= 1) {
    return ranges.slice();
  }

  const sorted = [...ranges].sort((left, right) => left.startCharacter - right.startCharacter || left.endCharacter - right.endCharacter);
  const merged: FormattingCharacterRange[] = [sorted[0]];

  for (const range of sorted.slice(1)) {
    const previous = merged[merged.length - 1];
    if (range.startCharacter <= previous.endCharacter) {
      previous.endCharacter = Math.max(previous.endCharacter, range.endCharacter);
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

function findLineCommentStart(text: string): number | null {
  let inString = false;

  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    const next = text[index + 1];

    if (ch === '"' && !inString) {
      inString = true;
      continue;
    }

    if (ch === "\\" && inString) {
      index++;
      continue;
    }

    if (ch === '"' && inString) {
      inString = false;
      continue;
    }

    if (!inString && ch === "/" && next === "/") {
      return index;
    }
  }

  return null;
}

function collectBlockCommentRanges(document: TextDocument): Map<number, FormattingCharacterRange[]> {
  const protectedRanges = new Map<number, FormattingCharacterRange[]>();
  let inBlockComment = false;

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const text = getLineText(document, lineIndex);
    let index = 0;
    let inString = false;

    while (index < text.length) {
      if (inBlockComment) {
        const closeIndex = text.indexOf("*/", index);
        if (closeIndex === -1) {
          addProtectedRange(protectedRanges, lineIndex, 0, text.length);
          index = text.length;
          continue;
        }

        addProtectedRange(protectedRanges, lineIndex, 0, closeIndex + 2);
        inBlockComment = false;
        index = closeIndex + 2;
        continue;
      }

      const ch = text[index];
      const next = text[index + 1];

      if (ch === '"' && !inString) {
        inString = true;
        index++;
        continue;
      }

      if (ch === "\\" && inString) {
        index += 2;
        continue;
      }

      if (ch === '"' && inString) {
        inString = false;
        index++;
        continue;
      }

      if (!inString && ch === "/" && next === "/") {
        break;
      }

      if (!inString && ch === "/" && next === "*") {
        let startCharacter = index;
        while (startCharacter > 0 && (text[startCharacter - 1] === " " || text[startCharacter - 1] === "\t")) {
          startCharacter--;
        }

        const closeIndex = text.indexOf("*/", index + 2);
        if (closeIndex === -1) {
          addProtectedRange(protectedRanges, lineIndex, startCharacter, text.length);
          inBlockComment = true;
          index = text.length;
          continue;
        }

        addProtectedRange(protectedRanges, lineIndex, startCharacter, closeIndex + 2);
        index = closeIndex + 2;
        continue;
      }

      index++;
    }
  }

  return protectedRanges;
}

function collectAdjacentStandaloneCommentRanges(
  document: TextDocument,
  syntaxProtectedRanges: Map<number, FormattingCharacterRange[]>
): Map<number, FormattingCharacterRange[]> {
  const protectedRanges = new Map<number, FormattingCharacterRange[]>();
  const queue: number[] = [];
  const seen = new Set<number>();

  for (const lineIndex of syntaxProtectedRanges.keys()) {
    queue.push(lineIndex - 1, lineIndex + 1);
  }

  while (queue.length > 0) {
    const lineIndex = queue.shift()!;
    if (lineIndex < 0 || lineIndex >= document.lineCount || seen.has(lineIndex)) {
      continue;
    }
    seen.add(lineIndex);

    const text = getLineText(document, lineIndex);
    const isStandaloneComment = /^\s*\/\//.test(text);
    const isBlankLine = text.trim().length === 0;
    if (!isStandaloneComment && !isBlankLine) {
      continue;
    }

    addProtectedRange(protectedRanges, lineIndex, 0, text.length);
    queue.push(lineIndex - 1, lineIndex + 1);
  }

  return protectedRanges;
}

function findAttachedCommentRange(
  text: string,
  protectedRanges: FormattingCharacterRange[]
): FormattingCharacterRange | null {
  const commentStart = findLineCommentStart(text);
  if (commentStart === null) {
    return null;
  }

  const hasProtectedSyntaxBeforeComment = protectedRanges.some((range) => range.endCharacter <= commentStart);
  if (!hasProtectedSyntaxBeforeComment) {
    return null;
  }

  let attachedStart = commentStart;
  while (attachedStart > 0 && (text[attachedStart - 1] === " " || text[attachedStart - 1] === "\t")) {
    attachedStart--;
  }

  return {
    startCharacter: attachedStart,
    endCharacter: text.length,
  };
}

function formatSegment(
  text: string,
  options: {
    preserveLeadingWhitespace?: boolean;
    preserveTrailingWhitespace?: boolean;
  }
): string {
  let startIndex = 0;
  let endIndex = text.length;

  if (options.preserveLeadingWhitespace) {
    const match = text.match(/^\s+/);
    if (match) {
      startIndex = match[0].length;
    }
  }

  if (options.preserveTrailingWhitespace) {
    const match = text.match(/\s+$/);
    if (match) {
      endIndex = Math.max(startIndex, text.length - match[0].length);
    }
  }

  const leading = text.slice(0, startIndex);
  const trailing = text.slice(endIndex);
  const middle = text.slice(startIndex, endIndex);

  return leading + formatLine(middle) + trailing;
}

function formatLineWithProtectedRanges(text: string, protectedRanges: FormattingCharacterRange[]): string {
  if (protectedRanges.length === 0) {
    return formatLine(text);
  }

  let cursor = 0;
  let formatted = "";
  const mergedRanges = mergeCharacterRanges(protectedRanges);

  mergedRanges.forEach((range, index) => {
    if (cursor < range.startCharacter) {
      formatted += formatSegment(text.slice(cursor, range.startCharacter), {
        preserveLeadingWhitespace: false,
        preserveTrailingWhitespace: true,
      });
    }
    formatted += text.slice(range.startCharacter, range.endCharacter);
    cursor = range.endCharacter;
  });

  if (cursor < text.length) {
    formatted += formatSegment(text.slice(cursor), {
      preserveLeadingWhitespace: false,
      preserveTrailingWhitespace: false,
    });
  }

  return formatted;
}

function collectStatementLines(program: ProgramNode): Set<number> {
  const lines = new Set<number>();

  const visitStatement = (statement: Statement): void => {
    addRangeLines(lines, statement.range);

    if (statement.kind === NodeKind.Job || statement.kind === NodeKind.Def) {
      visitBlock(statement.body);
      return;
    }

    if (statement.block) {
      visitBlock(statement.block);
    }

    const expression = statement.expression as any;
    if (expression?.kind === NodeKind.If) {
      visitIf(expression);
    }
  };

  const visitBlock = (block: { range: Range; statements: Statement[] }): void => {
    addRangeLines(lines, block.range);
    for (const statement of block.statements) {
      visitStatement(statement);
    }
  };

  const visitIf = (ifNode: { range: Range; thenBlock: { range: Range; statements: Statement[] }; elseBlock?: { range: Range; statements: Statement[] } }): void => {
    addRangeLines(lines, ifNode.range);
    visitBlock(ifNode.thenBlock);
    if (ifNode.elseBlock) {
      visitBlock(ifNode.elseBlock);
    }
  };

  addRangeLines(lines, program.range);
  for (const statement of program.statements) {
    visitStatement(statement);
  }

  return lines;
}

function getLineText(document: TextDocument, lineIndex: number): string {
  const line = document.getText({
    start: Position.create(lineIndex, 0),
    end: Position.create(lineIndex + 1, 0),
  });
  const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
  return withoutNewline.endsWith("\r") ? withoutNewline.slice(0, -1) : withoutNewline;
}

export function buildFormattingInput(document: TextDocument): FormattingInput {
  const { tokens } = lexText(document.getText());
  const { program, diagnostics } = parseText(document.getText());
  const coveredLines = collectStatementLines(program);
  const parseMode: FormattingParseMode = diagnostics.length > 0 ? "recovery" : "parsed";
  const diagnosticLines = collectDiagnosticLines(diagnostics);
  const syntaxProtectedRanges = parseMode === "recovery" ? collectProtectedRanges(document, tokens, diagnostics) : new Map<number, FormattingCharacterRange[]>();
  const adjacentStandaloneCommentRanges =
    parseMode === "recovery" ? collectAdjacentStandaloneCommentRanges(document, syntaxProtectedRanges) : new Map<number, FormattingCharacterRange[]>();
  const blockCommentRanges = collectBlockCommentRanges(document);
  const lines: FormattingLine[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const originalText = getLineText(document, lineIndex);
    const lineProtectedRanges = [
      ...(syntaxProtectedRanges.get(lineIndex) ?? []),
      ...(adjacentStandaloneCommentRanges.get(lineIndex) ?? []),
      ...(blockCommentRanges.get(lineIndex) ?? []),
    ];
    const attachedCommentRange =
      parseMode === "recovery" && !/^\s*\/\//.test(originalText)
        ? findAttachedCommentRange(originalText, lineProtectedRanges)
        : null;
    lines.push({
      lineIndex,
      originalText,
      kind: classifyLine(originalText),
      coveredBySyntax: coveredLines.has(lineIndex),
      intersectsDiagnostic: diagnosticLines.has(lineIndex),
      protectedRanges: mergeCharacterRanges(
        attachedCommentRange ? [...lineProtectedRanges, attachedCommentRange] : lineProtectedRanges
      ),
      safeToFormat: parseMode === "parsed" || coveredLines.has(lineIndex),
    });
  }

  return {
    document,
    program,
    syntaxDiagnostics: diagnostics,
    parseMode,
    lines,
  };
}

export function planFormatting(input: FormattingInput, request: FormattingRequest): FormattingDecision[] {
  const decisions: FormattingDecision[] = [];

  for (let lineIndex = request.startLine; lineIndex <= request.endLine; lineIndex++) {
    const line = input.lines[lineIndex];
    decisions.push({
      lineIndex,
      originalText: line.originalText,
      formattedText: line.safeToFormat ? formatLineWithProtectedRanges(line.originalText, line.protectedRanges) : line.originalText,
      kind: line.kind,
      parseMode: input.parseMode,
      coveredBySyntax: line.coveredBySyntax,
      safeToFormat: line.safeToFormat,
    });
  }

  return decisions;
}

export function emitFormattingEdits(decisions: FormattingDecision[]): TextEdit[] {
  const edits: TextEdit[] = [];

  for (const decision of decisions) {
    if (decision.formattedText !== decision.originalText) {
      edits.push(
        TextEdit.replace(
          Range.create(
            Position.create(decision.lineIndex, 0),
            Position.create(decision.lineIndex, decision.originalText.length)
          ),
          decision.formattedText
        )
      );
    }
  }

  return edits;
}

export function formatDocument(document: TextDocument): TextEdit[] {
  const input = buildFormattingInput(document);
  const decisions = planFormatting(input, { startLine: 0, endLine: document.lineCount - 1 });
  return emitFormattingEdits(decisions);
}

export function formatDocumentRange(document: TextDocument, startLine: number, endLine: number): TextEdit[] {
  const input = buildFormattingInput(document);
  const decisions = planFormatting(input, { startLine, endLine });
  return emitFormattingEdits(decisions);
}
