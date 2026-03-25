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
  const lines: FormattingLine[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const originalText = getLineText(document, lineIndex);
    lines.push({
      lineIndex,
      originalText,
      kind: classifyLine(originalText),
      coveredBySyntax: coveredLines.has(lineIndex),
    });
  }

  return {
    document,
    program,
    syntaxDiagnostics: diagnostics,
    parseMode: diagnostics.length > 0 ? "recovery" : "parsed",
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
      formattedText: formatLine(line.originalText),
      kind: line.kind,
      parseMode: input.parseMode,
      coveredBySyntax: line.coveredBySyntax,
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
