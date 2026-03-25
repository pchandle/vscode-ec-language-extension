import { Position, Range, TextEdit } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { NodeKind, ProgramNode, Statement } from "./lang/ast";
import { parseText } from "./lang/parser";
import { SyntaxDiagnostic } from "./lang/tokens";

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

function collectProtectedRanges(
  document: TextDocument,
  diagnostics: SyntaxDiagnostic[]
): Map<number, FormattingCharacterRange[]> {
  const protectedRanges = new Map<number, FormattingCharacterRange[]>();

  for (const diagnostic of diagnostics) {
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
      const ranges = protectedRanges.get(lineIndex) ?? [];
      ranges.push({ startCharacter, endCharacter });
      protectedRanges.set(lineIndex, ranges);
    }
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
        preserveLeadingWhitespace: index > 0,
        preserveTrailingWhitespace: true,
      });
    }
    formatted += text.slice(range.startCharacter, range.endCharacter);
    cursor = range.endCharacter;
  });

  if (cursor < text.length) {
    formatted += formatSegment(text.slice(cursor), {
      preserveLeadingWhitespace: mergedRanges.length > 0,
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
  return line.endsWith("\n") ? line.slice(0, -1) : line;
}

export function buildFormattingInput(document: TextDocument): FormattingInput {
  const { program, diagnostics } = parseText(document.getText());
  const coveredLines = collectStatementLines(program);
  const parseMode: FormattingParseMode = diagnostics.length > 0 ? "recovery" : "parsed";
  const diagnosticLines = collectDiagnosticLines(diagnostics);
  const protectedRanges = parseMode === "recovery" ? collectProtectedRanges(document, diagnostics) : new Map<number, FormattingCharacterRange[]>();
  const lines: FormattingLine[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const originalText = getLineText(document, lineIndex);
    lines.push({
      lineIndex,
      originalText,
      kind: classifyLine(originalText),
      coveredBySyntax: coveredLines.has(lineIndex),
      intersectsDiagnostic: diagnosticLines.has(lineIndex),
      protectedRanges: protectedRanges.get(lineIndex) ?? [],
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
