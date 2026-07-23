import { Position, Range, TextEdit } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { BlockNode, NodeKind, ProgramNode, Statement } from "./lang/ast";
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
  desiredIndentColumns?: number;
  allowIndentOnProtectedLine?: boolean;
  deleteLine?: boolean;
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
  deleteLine: boolean;
}

const INDENT_SIZE = 2;

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
  if (isStandaloneLineComment(text)) {
    return "comment";
  }
  if (isBlankLine(text)) {
    return "blank";
  }
  return "content";
}

function isStandaloneLineComment(text: string): boolean {
  return /^\s*\/\//.test(text);
}

function isBlankLine(text: string): boolean {
  return text.trim().length === 0;
}

function leadingWhitespaceWidth(text: string): number {
  const match = text.match(/^[ \t]*/);
  return match ? match[0].length : 0;
}

function isRecoveryCommentOwnershipSeparatorLine(text: string): boolean {
  return text.trim() === "}";
}

function isFullyProtectedLine(text: string, protectedRanges: FormattingCharacterRange[]): boolean {
  if (protectedRanges.length === 0) {
    return false;
  }

  const mergedRanges = mergeCharacterRanges(protectedRanges);
  return mergedRanges.length === 1 && mergedRanges[0].startCharacter === 0 && mergedRanges[0].endCharacter >= text.length;
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

function collectStringLiteralRanges(
  document: TextDocument,
  tokens: Token[]
): Map<number, FormattingCharacterRange[]> {
  const protectedRanges = new Map<number, FormattingCharacterRange[]>();

  for (const token of tokens) {
    if (token.kind !== TokenKind.String) {
      continue;
    }

    for (let lineIndex = token.range.start.line; lineIndex <= token.range.end.line; lineIndex++) {
      const lineLength = getLineText(document, lineIndex).length;
      const startCharacter = lineIndex === token.range.start.line ? clampCharacter(token.range.start.character, lineLength) : 0;
      const endCharacter = lineIndex === token.range.end.line ? clampCharacter(token.range.end.character, lineLength) : lineLength;
      addProtectedRange(protectedRanges, lineIndex, startCharacter, endCharacter);
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
  const addOwnedGroup = (startLine: number, direction: -1 | 1): void => {
    const pendingBlankLines: number[] = [];
    const pendingSeparatorLines: number[] = [];
    let lineIndex = startLine;
    let sawComment = false;
    let usedSeparator = false;

    while (lineIndex >= 0 && lineIndex < document.lineCount) {
      const text = getLineText(document, lineIndex);
      const isStandaloneComment = isStandaloneLineComment(text);
      const isTriviaLine = isBlankLine(text);
      const isSeparatorLine = isRecoveryCommentOwnershipSeparatorLine(text);

      if (isStandaloneComment) {
        if (!sawComment) {
          for (const blankLine of pendingBlankLines) {
            addProtectedRange(protectedRanges, blankLine, 0, getLineText(document, blankLine).length);
          }
          for (const separatorLine of pendingSeparatorLines) {
            addProtectedRange(protectedRanges, separatorLine, 0, getLineText(document, separatorLine).length);
          }
          sawComment = true;
        }
        addProtectedRange(protectedRanges, lineIndex, 0, text.length);
        lineIndex += direction;
        continue;
      }

      if (isTriviaLine) {
        pendingBlankLines.push(lineIndex);
        lineIndex += direction;
        continue;
      }

      if (!sawComment && !usedSeparator && isSeparatorLine) {
        pendingSeparatorLines.push(lineIndex);
        usedSeparator = true;
        lineIndex += direction;
        continue;
      }

      // Non-trivia content remains the current recovery ownership boundary.
      break;
    }

    if (sawComment) {
      for (const blankLine of pendingBlankLines) {
        addProtectedRange(protectedRanges, blankLine, 0, getLineText(document, blankLine).length);
      }
      for (const separatorLine of pendingSeparatorLines) {
        addProtectedRange(protectedRanges, separatorLine, 0, getLineText(document, separatorLine).length);
      }
    }
  };

  for (const lineIndex of syntaxProtectedRanges.keys()) {
    const text = getLineText(document, lineIndex);
    const isTriviaLine = isStandaloneLineComment(text) || isBlankLine(text);

    if (isTriviaLine) {
      addOwnedGroup(lineIndex, -1);
      addOwnedGroup(lineIndex, 1);
      continue;
    }

    addOwnedGroup(lineIndex - 1, -1);
    addOwnedGroup(lineIndex + 1, 1);
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

function isBraceBlock(document: TextDocument, block: BlockNode): boolean {
  const lineText = getLineText(document, block.range.start.line);
  return lineText[block.range.start.character] === "{";
}

function isStandaloneElseLine(text: string): boolean {
  return text.trim() === "else";
}

function containsThenKeyword(text: string): boolean {
  return /\bthen\b/.test(text);
}

function isStandaloneEndLine(text: string): boolean {
  return /^end(\s|$)/.test(text.trim());
}

function isBareEndLine(text: string): boolean {
  return text.trim() === "end";
}

function isEndArrowLine(text: string): boolean {
  return /^end\s*->/.test(text.trim());
}

function setDesiredIndent(desiredIndentColumns: Map<number, number>, lineIndex: number, indentColumns: number): void {
  desiredIndentColumns.set(lineIndex, Math.max(0, indentColumns));
}

function isInvocationContinuationCandidate(statement: Statement): boolean {
  if (statement.kind !== NodeKind.Statement) {
    return false;
  }

  const keyword = statement.keyword?.lexeme.toLowerCase();
  return keyword === "sub" || keyword === "host" || keyword === "join";
}

function isDefaultsContinuationCandidate(statement: Statement): boolean {
  if (statement.kind !== NodeKind.Statement) {
    return false;
  }

  return statement.keyword?.lexeme.toLowerCase() === "defaults";
}

function isAdditionalOutputContinuationCandidate(statement: Statement): boolean {
  if (statement.kind !== NodeKind.Statement) {
    return false;
  }

  const keyword = statement.keyword?.lexeme.toLowerCase();
  if (keyword === "sub" || keyword === "host" || keyword === "join" || keyword === "defaults") {
    return false;
  }

  const expression = statement.expression as any;
  if (expression?.kind === NodeKind.If) {
    return false;
  }

  return statement.targets.length > 0 || Boolean(statement.obligationOrder?.length);
}

function isLineWithinBraceBlockInteriorOrClose(lineIndex: number, braceBlocks: BlockNode[]): boolean {
  return braceBlocks.some((block) => lineIndex > block.range.start.line && lineIndex <= block.range.end.line);
}

function collectBraceBlocks(statement: Statement): BlockNode[] {
  const braceBlocks: BlockNode[] = [];
  const seen = new Set<string>();
  const addBlock = (block: BlockNode | undefined): void => {
    if (!block) {
      return;
    }
    const key = `${block.range.start.line}:${block.range.start.character}-${block.range.end.line}:${block.range.end.character}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    braceBlocks.push(block);
  };

  if (statement.kind === NodeKind.Statement) {
    addBlock(statement.block);
    statement.obligationOrder?.forEach((item: BlockNode | Token) => {
      if ((item as BlockNode).kind === NodeKind.Block) {
        addBlock(item as BlockNode);
      }
    });
  }

  return braceBlocks;
}

function collectParsedIndentation(document: TextDocument, program: ProgramNode): Map<number, number> {
  const desiredIndentColumns = new Map<number, number>();

  const findLineMatching = (startLine: number, endLine: number, predicate: (text: string) => boolean): number | undefined => {
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
      if (predicate(getLineText(document, lineIndex))) {
        return lineIndex;
      }
    }
    return undefined;
  };

  const findLastLineMatching = (startLine: number, endLine: number, predicate: (text: string) => boolean): number | undefined => {
    for (let lineIndex = endLine; lineIndex >= startLine; lineIndex--) {
      if (predicate(getLineText(document, lineIndex))) {
        return lineIndex;
      }
    }
    return undefined;
  };

  const setNonBlankIndentRange = (startLine: number, endLine: number, indentColumns: number): void => {
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
      if (!isBlankLine(getLineText(document, lineIndex))) {
        setDesiredIndent(desiredIndentColumns, lineIndex, indentColumns);
      }
    }
  };

  const setAttachedStandaloneCommentIndent = (anchorLineIndex: number, indentColumns: number): void => {
    const setCommentGroupIndent = (startLineIndex: number, direction: -1 | 1): void => {
      const pendingBlankLines: number[] = [];
      const commentLines: number[] = [];
      let lineIndex = startLineIndex;

      while (lineIndex >= 0 && lineIndex < document.lineCount) {
        const text = getLineText(document, lineIndex);
        if (isStandaloneLineComment(text)) {
          commentLines.push(lineIndex);
          lineIndex += direction;
          continue;
        }

        if (isBlankLine(text)) {
          pendingBlankLines.push(lineIndex);
          lineIndex += direction;
          continue;
        }

        break;
      }

      if (commentLines.length === 0) {
        return;
      }

      for (const commentLineIndex of [...commentLines, ...pendingBlankLines]) {
        setDesiredIndent(desiredIndentColumns, commentLineIndex, indentColumns);
      }
    };

    setCommentGroupIndent(anchorLineIndex - 1, -1);
    setCommentGroupIndent(anchorLineIndex + 1, 1);
  };

  const visitDelimitedBody = (
    startLineIndex: number,
    body: { range: Range; statements: Statement[] },
    headerIndentColumns: number
  ): void => {
    const bodyIndentColumns = headerIndentColumns + INDENT_SIZE;
    const endLineIndex =
      findLineMatching(
        body.range.end.line + 1,
        document.lineCount - 1,
        (text) => isStandaloneEndLine(text) && leadingWhitespaceWidth(text) <= headerIndentColumns + 1
      ) ?? body.range.end.line;

    const bodyStartLine = startLineIndex + 1;
    const bodyEndLine = endLineIndex - 1;
    if (bodyStartLine <= bodyEndLine) {
      setNonBlankIndentRange(bodyStartLine, bodyEndLine, bodyIndentColumns);
    }

    setDesiredIndent(desiredIndentColumns, endLineIndex, headerIndentColumns);

    for (const nestedStatement of body.statements) {
      visitStatement(nestedStatement, bodyIndentColumns);
    }
  };

  const visitDelimitedHeaderContinuation = (
    startLineIndex: number,
    body: { range: Range; statements: Statement[] },
    headerIndentColumns: number
  ): void => {
    const headerContinuationStartLine = startLineIndex + 1;
    const headerContinuationEndLine = body.range.start.line - 1;

    if (headerContinuationStartLine <= headerContinuationEndLine) {
      for (let lineIndex = headerContinuationStartLine; lineIndex <= headerContinuationEndLine; lineIndex++) {
        if (!isBlankLine(getLineText(document, lineIndex))) {
          setDesiredIndent(desiredIndentColumns, lineIndex, headerIndentColumns + INDENT_SIZE);
          setAttachedStandaloneCommentIndent(lineIndex, headerIndentColumns + INDENT_SIZE);
        }
      }
    }
  };

  const visitStatementContinuation = (statement: Statement, statementIndentColumns: number): void => {
    if (
      !isInvocationContinuationCandidate(statement) &&
      !isDefaultsContinuationCandidate(statement) &&
      !isAdditionalOutputContinuationCandidate(statement)
    ) {
      return;
    }

    if (statement.range.start.line >= statement.range.end.line) {
      return;
    }

    if (statement.kind !== NodeKind.Statement) {
      return;
    }

    if (isDefaultsContinuationCandidate(statement)) {
      for (let lineIndex = statement.range.start.line + 1; lineIndex <= statement.range.end.line; lineIndex++) {
        if (!isBlankLine(getLineText(document, lineIndex))) {
          setDesiredIndent(desiredIndentColumns, lineIndex, statementIndentColumns + INDENT_SIZE);
          setAttachedStandaloneCommentIndent(lineIndex, statementIndentColumns + INDENT_SIZE);
        }
      }
      return;
    }

    const braceBlocks = collectBraceBlocks(statement).filter((block) => isBraceBlock(document, block));

    if (isAdditionalOutputContinuationCandidate(statement)) {
      const continuationLineIndexes = new Set<number>();

      for (const target of statement.targets) {
        if (target.range.start.line > statement.range.start.line) {
          continuationLineIndexes.add(target.range.start.line);
        }
      }

      statement.obligationOrder?.forEach((item: BlockNode | Token) => {
        if ((item as BlockNode).kind === NodeKind.Block) {
          const block = item as BlockNode;
          if (block.range.start.line > statement.range.start.line) {
            continuationLineIndexes.add(block.range.start.line);
          }
          return;
        }

        const token = item as Token;
        if (token.range.start.line > statement.range.start.line) {
          continuationLineIndexes.add(token.range.start.line);
        }
      });

      for (const lineIndex of continuationLineIndexes) {
        if (!isBlankLine(getLineText(document, lineIndex))) {
          setDesiredIndent(desiredIndentColumns, lineIndex, statementIndentColumns + INDENT_SIZE);
          setAttachedStandaloneCommentIndent(lineIndex, statementIndentColumns + INDENT_SIZE);
        }
      }

      return;
    }

    for (let lineIndex = statement.range.start.line + 1; lineIndex <= statement.range.end.line; lineIndex++) {
      if (isBlankLine(getLineText(document, lineIndex))) {
        continue;
      }

      if (isLineWithinBraceBlockInteriorOrClose(lineIndex, braceBlocks)) {
        continue;
      }

      setDesiredIndent(desiredIndentColumns, lineIndex, statementIndentColumns + INDENT_SIZE);
      setAttachedStandaloneCommentIndent(lineIndex, statementIndentColumns + INDENT_SIZE);
    }
  };

  const visitIf = (
    ifNode: { range: Range; thenBlock: { range: Range; statements: Statement[] }; elseBlock?: { range: Range; statements: Statement[] } },
    ifIndentColumns: number
  ): void => {
    const ifLineIndex = ifNode.range.start.line;
    const branchIndentColumns = ifIndentColumns + INDENT_SIZE;

    setDesiredIndent(desiredIndentColumns, ifLineIndex, ifIndentColumns);

    const elseSearchEndLine = ifNode.elseBlock ? Math.max(ifNode.thenBlock.range.end.line + 1, ifNode.elseBlock.range.start.line) : ifNode.range.end.line;
    const elseLineIndex =
      ifNode.elseBlock
        ? findLineMatching(ifNode.thenBlock.range.end.line + 1, elseSearchEndLine, isStandaloneElseLine)
        : undefined;

    const endSearchStartLine = ifNode.elseBlock
      ? Math.max((elseLineIndex ?? ifNode.elseBlock.range.end.line) + 1, ifNode.elseBlock.range.end.line)
      : Math.max(ifNode.thenBlock.range.end.line + 1, ifLineIndex + 1);
    const endLineIndex =
      findLineMatching(endSearchStartLine, document.lineCount - 1, isStandaloneEndLine) ?? ifNode.range.end.line;

    const thenSearchEndLine =
      ifNode.thenBlock.statements[0]?.range.start.line ??
      elseLineIndex ??
      endLineIndex;
    const thenLineIndex =
      findLineMatching(ifLineIndex, thenSearchEndLine, containsThenKeyword) ?? ifLineIndex;

    const headerContinuationStartLine = ifLineIndex + 1;
    const headerContinuationEndLine = thenLineIndex;
    if (headerContinuationStartLine <= headerContinuationEndLine) {
      for (let lineIndex = headerContinuationStartLine; lineIndex <= headerContinuationEndLine; lineIndex++) {
        if (!isBlankLine(getLineText(document, lineIndex))) {
          setDesiredIndent(desiredIndentColumns, lineIndex, branchIndentColumns);
          setAttachedStandaloneCommentIndent(lineIndex, branchIndentColumns);
        }
      }
    }

    const thenBodyStartLine = thenLineIndex + 1;
    const thenBodyEndLine = (elseLineIndex ?? endLineIndex) - 1;
    if (thenBodyStartLine <= thenBodyEndLine) {
      setNonBlankIndentRange(thenBodyStartLine, thenBodyEndLine, branchIndentColumns);
    }

    if (elseLineIndex !== undefined) {
      setDesiredIndent(desiredIndentColumns, elseLineIndex, ifIndentColumns);
      const elseBodyStartLine = elseLineIndex + 1;
      const elseBodyEndLine = endLineIndex - 1;
      if (elseBodyStartLine <= elseBodyEndLine) {
        setNonBlankIndentRange(elseBodyStartLine, elseBodyEndLine, branchIndentColumns);
      }
    }

    setDesiredIndent(desiredIndentColumns, endLineIndex, ifIndentColumns);

    if (endLineIndex + 1 <= ifNode.range.end.line) {
      for (let lineIndex = endLineIndex + 1; lineIndex <= ifNode.range.end.line; lineIndex++) {
        if (!isBlankLine(getLineText(document, lineIndex))) {
          setDesiredIndent(desiredIndentColumns, lineIndex, branchIndentColumns);
          setAttachedStandaloneCommentIndent(lineIndex, branchIndentColumns);
        }
      }
    }

    for (const nestedStatement of ifNode.thenBlock.statements) {
      visitStatement(nestedStatement, branchIndentColumns);
    }

    ifNode.elseBlock?.statements.forEach((nestedStatement: Statement) => visitStatement(nestedStatement, branchIndentColumns));
  };

  const visitStatement = (statement: Statement, desiredIndentColumnsForStatement?: number): void => {
    const statementLineIndex = statement.range.start.line;
    const statementIndentColumns =
      desiredIndentColumnsForStatement ?? leadingWhitespaceWidth(getLineText(document, statementLineIndex));

    if (desiredIndentColumnsForStatement !== undefined) {
      setDesiredIndent(desiredIndentColumns, statementLineIndex, desiredIndentColumnsForStatement);
    }

    const braceBlocks = collectBraceBlocks(statement);

    for (const block of braceBlocks) {
      if (!isBraceBlock(document, block)) {
        continue;
      }

      const blockContentIndentColumns = statementIndentColumns + INDENT_SIZE;
      const openLineIndex = block.range.start.line;
      const closeLineIndex = block.range.end.line;

      if (closeLineIndex > openLineIndex) {
        setDesiredIndent(desiredIndentColumns, closeLineIndex, statementIndentColumns);
      }

      for (let lineIndex = openLineIndex + 1; lineIndex < closeLineIndex; lineIndex++) {
        if (!isBlankLine(getLineText(document, lineIndex))) {
          setDesiredIndent(desiredIndentColumns, lineIndex, blockContentIndentColumns);
        }
      }

      for (const nestedStatement of block.statements) {
        visitStatement(nestedStatement, blockContentIndentColumns);
      }
    }

    if (statement.kind === NodeKind.Job || statement.kind === NodeKind.Def) {
      visitDelimitedHeaderContinuation(statementLineIndex, statement.body, statementIndentColumns);
      visitDelimitedBody(statementLineIndex, statement.body, statementIndentColumns);
      return;
    }

    visitStatementContinuation(statement, statementIndentColumns);

    const expression = statement.expression as any;
    if (expression?.kind === NodeKind.If) {
      visitIf(expression, statementIndentColumns);
    }
  };

  for (const statement of program.statements) {
    visitStatement(statement);
  }

  return desiredIndentColumns;
}

function collectParsedBlankLinesToDelete(document: TextDocument, program: ProgramNode): Set<number> {
  const blankLinesToDelete = new Set<number>();

  const findLineMatching = (startLine: number, endLine: number, predicate: (text: string) => boolean): number | undefined => {
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
      if (predicate(getLineText(document, lineIndex))) {
        return lineIndex;
      }
    }
    return undefined;
  };

  const findLastLineMatching = (startLine: number, endLine: number, predicate: (text: string) => boolean): number | undefined => {
    for (let lineIndex = endLine; lineIndex >= startLine; lineIndex--) {
      if (predicate(getLineText(document, lineIndex))) {
        return lineIndex;
      }
    }
    return undefined;
  };

  const markExtraBlankLinesInRange = (startLine: number, endLine: number): void => {
    let sawBlankLine = false;

    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
      if (isBlankLine(getLineText(document, lineIndex))) {
        if (sawBlankLine) {
          blankLinesToDelete.add(lineIndex);
        } else {
          sawBlankLine = true;
        }
        continue;
      }

      sawBlankLine = false;
    }
  };

  const markCommentAdjacentDelimiterGap = (delimiterLineIndex: number): void => {
    const blankLinesBetweenCommentAndDelimiter: number[] = [];

    for (let lineIndex = delimiterLineIndex - 1; lineIndex >= 0; lineIndex--) {
      const lineText = getLineText(document, lineIndex);

      if (isBlankLine(lineText)) {
        blankLinesBetweenCommentAndDelimiter.push(lineIndex);
        continue;
      }

      if (blankLinesBetweenCommentAndDelimiter.length > 0 && isStandaloneLineComment(lineText)) {
        blankLinesBetweenCommentAndDelimiter.forEach((blankLineIndex) => blankLinesToDelete.add(blankLineIndex));
      }

      break;
    }
  };

  const markContentAdjacentDelimiterGap = (delimiterLineIndex: number): void => {
    const blankLinesBetweenContentAndDelimiter: number[] = [];

    for (let lineIndex = delimiterLineIndex - 1; lineIndex >= 0; lineIndex--) {
      const lineText = getLineText(document, lineIndex);

      if (isBlankLine(lineText)) {
        blankLinesBetweenContentAndDelimiter.push(lineIndex);
        continue;
      }

      if (blankLinesBetweenContentAndDelimiter.length > 0 && !isStandaloneLineComment(lineText)) {
        blankLinesBetweenContentAndDelimiter.forEach((blankLineIndex) => blankLinesToDelete.add(blankLineIndex));
      }

      break;
    }
  };

  const markDelimiterLeadingCommentGap = (delimiterLineIndex: number): void => {
    const blankLinesBetweenDelimiterAndComment: number[] = [];

    for (let lineIndex = delimiterLineIndex + 1; lineIndex < document.lineCount; lineIndex++) {
      const lineText = getLineText(document, lineIndex);

      if (isBlankLine(lineText)) {
        blankLinesBetweenDelimiterAndComment.push(lineIndex);
        continue;
      }

      if (blankLinesBetweenDelimiterAndComment.length > 0 && isStandaloneLineComment(lineText)) {
        blankLinesBetweenDelimiterAndComment.forEach((blankLineIndex) => blankLinesToDelete.add(blankLineIndex));
      }

      break;
    }
  };

  const markDelimiterLeadingContentGap = (delimiterLineIndex: number): void => {
    const blankLinesBetweenDelimiterAndContent: number[] = [];

    for (let lineIndex = delimiterLineIndex + 1; lineIndex < document.lineCount; lineIndex++) {
      const lineText = getLineText(document, lineIndex);

      if (isBlankLine(lineText)) {
        blankLinesBetweenDelimiterAndContent.push(lineIndex);
        continue;
      }

      if (blankLinesBetweenDelimiterAndContent.length > 0 && !isStandaloneLineComment(lineText)) {
        blankLinesBetweenDelimiterAndContent.forEach((blankLineIndex) => blankLinesToDelete.add(blankLineIndex));
      }

      break;
    }
  };

  const visitDelimitedBody = (
    startLineIndex: number,
    body: { range: Range; statements: Statement[] }
  ): void => {
    const headerIndentColumns = leadingWhitespaceWidth(getLineText(document, startLineIndex));
    const endLineIndex =
      findLineMatching(
        body.range.end.line + 1,
        document.lineCount - 1,
        (text) => isStandaloneEndLine(text) && leadingWhitespaceWidth(text) <= headerIndentColumns + 1
      ) ?? body.range.end.line;
    const bodyLeadingBoundaryLineIndex =
      findLastLineMatching(
        startLineIndex,
        Math.max(startLineIndex, body.range.start.line - 1),
        (text) => !isBlankLine(text) && !isStandaloneLineComment(text)
      ) ?? startLineIndex;
    const bodyStartLine = startLineIndex + 1;
    const bodyEndLine = endLineIndex - 1;

    if (bodyStartLine <= bodyEndLine) {
      markExtraBlankLinesInRange(bodyStartLine, bodyEndLine);
    }

    if (bodyLeadingBoundaryLineIndex < endLineIndex) {
      markDelimiterLeadingCommentGap(bodyLeadingBoundaryLineIndex);
      markDelimiterLeadingContentGap(bodyLeadingBoundaryLineIndex);
    }

    if (isBareEndLine(getLineText(document, endLineIndex))) {
      markCommentAdjacentDelimiterGap(endLineIndex);
      markContentAdjacentDelimiterGap(endLineIndex);
    }

    for (const nestedStatement of body.statements) {
      visitStatement(nestedStatement);
    }
  };

  const visitDelimitedHeaderContinuation = (
    startLineIndex: number,
    body: { range: Range; statements: Statement[] }
  ): void => {
    const headerContinuationStartLine = startLineIndex + 1;
    const headerContinuationEndLine = body.range.start.line - 1;

    if (headerContinuationStartLine <= headerContinuationEndLine) {
      markExtraBlankLinesInRange(headerContinuationStartLine, headerContinuationEndLine);
    }
  };

  const visitDefaultsContinuation = (statement: Statement): void => {
    if (!isDefaultsContinuationCandidate(statement) || statement.range.start.line >= statement.range.end.line) {
      return;
    }

    markExtraBlankLinesInRange(statement.range.start.line + 1, statement.range.end.line);
    markDelimiterLeadingCommentGap(statement.range.start.line);
  };

  const visitInvocationContinuation = (statement: Statement): void => {
    if (!isInvocationContinuationCandidate(statement) || statement.range.start.line >= statement.range.end.line) {
      return;
    }

    const braceBlocks = collectBraceBlocks(statement).filter((block) => isBraceBlock(document, block));
    let sawBlankLine = false;

    markDelimiterLeadingCommentGap(statement.range.start.line);

    for (let lineIndex = statement.range.start.line + 1; lineIndex <= statement.range.end.line; lineIndex++) {
      if (isLineWithinBraceBlockInteriorOrClose(lineIndex, braceBlocks)) {
        sawBlankLine = false;
        continue;
      }

      if (isBlankLine(getLineText(document, lineIndex))) {
        if (sawBlankLine) {
          blankLinesToDelete.add(lineIndex);
        } else {
          sawBlankLine = true;
        }
        continue;
      }

      sawBlankLine = false;
    }
  };

  const visitAdditionalOutputContinuation = (statement: Statement): void => {
    if (!isAdditionalOutputContinuationCandidate(statement) || statement.range.start.line >= statement.range.end.line) {
      return;
    }

    const braceBlocks = collectBraceBlocks(statement).filter((block) => isBraceBlock(document, block));
    let sawBlankLine = false;

    markDelimiterLeadingCommentGap(statement.range.start.line);

    for (let lineIndex = statement.range.start.line + 1; lineIndex <= statement.range.end.line; lineIndex++) {
      if (isLineWithinBraceBlockInteriorOrClose(lineIndex, braceBlocks)) {
        sawBlankLine = false;
        continue;
      }

      if (isBlankLine(getLineText(document, lineIndex))) {
        if (sawBlankLine) {
          blankLinesToDelete.add(lineIndex);
        } else {
          sawBlankLine = true;
        }
        continue;
      }

      sawBlankLine = false;
    }
  };

  const visitIf = (
    ifNode: { range: Range; thenBlock: { range: Range; statements: Statement[] }; elseBlock?: { range: Range; statements: Statement[] } }
  ): void => {
    const ifLineIndex = ifNode.range.start.line;
    const elseSearchEndLine = ifNode.elseBlock ? Math.max(ifNode.thenBlock.range.end.line + 1, ifNode.elseBlock.range.start.line) : ifNode.range.end.line;
    const elseLineIndex =
      ifNode.elseBlock
        ? findLineMatching(ifNode.thenBlock.range.end.line + 1, elseSearchEndLine, isStandaloneElseLine)
        : undefined;
    const endSearchStartLine = ifNode.elseBlock
      ? Math.max((elseLineIndex ?? ifNode.elseBlock.range.end.line) + 1, ifNode.elseBlock.range.end.line)
      : Math.max(ifNode.thenBlock.range.end.line + 1, ifLineIndex + 1);
    const endLineIndex =
      findLineMatching(endSearchStartLine, document.lineCount - 1, isStandaloneEndLine) ?? ifNode.range.end.line;
    const thenSearchEndLine =
      ifNode.thenBlock.statements[0]?.range.start.line ??
      elseLineIndex ??
      endLineIndex;
    const thenLineIndex =
      findLineMatching(ifLineIndex, thenSearchEndLine, containsThenKeyword) ?? ifLineIndex;

    const headerContinuationStartLine = ifLineIndex + 1;
    const headerContinuationEndLine = thenLineIndex;
    if (headerContinuationStartLine <= headerContinuationEndLine) {
      markExtraBlankLinesInRange(headerContinuationStartLine, headerContinuationEndLine);
    }

    const thenBodyStartLine = thenLineIndex + 1;
    const thenBodyEndLine = (elseLineIndex ?? endLineIndex) - 1;
    if (thenBodyStartLine <= thenBodyEndLine) {
      markExtraBlankLinesInRange(thenBodyStartLine, thenBodyEndLine);
      markDelimiterLeadingCommentGap(thenLineIndex);
      markDelimiterLeadingContentGap(thenLineIndex);
    }

    if (elseLineIndex !== undefined) {
      const elseBodyStartLine = elseLineIndex + 1;
      const elseBodyEndLine = endLineIndex - 1;
      if (elseBodyStartLine <= elseBodyEndLine) {
        markExtraBlankLinesInRange(elseBodyStartLine, elseBodyEndLine);
        markDelimiterLeadingCommentGap(elseLineIndex);
        markDelimiterLeadingContentGap(elseLineIndex);
      }

      markCommentAdjacentDelimiterGap(elseLineIndex);
    }

    if (isBareEndLine(getLineText(document, endLineIndex)) || isEndArrowLine(getLineText(document, endLineIndex))) {
      markCommentAdjacentDelimiterGap(endLineIndex);
      if (isBareEndLine(getLineText(document, endLineIndex))) {
        markContentAdjacentDelimiterGap(endLineIndex);
      }
    }

    if (endLineIndex + 1 <= ifNode.range.end.line) {
      markExtraBlankLinesInRange(endLineIndex + 1, ifNode.range.end.line);
      if (isEndArrowLine(getLineText(document, endLineIndex))) {
        markDelimiterLeadingCommentGap(endLineIndex);
        markDelimiterLeadingContentGap(endLineIndex);
      }
    }

    for (const nestedStatement of ifNode.thenBlock.statements) {
      visitStatement(nestedStatement);
    }

    ifNode.elseBlock?.statements.forEach((nestedStatement: Statement) => visitStatement(nestedStatement));
  };

  const visitStatement = (statement: Statement): void => {
    const braceBlocks = collectBraceBlocks(statement);

    for (const block of braceBlocks) {
      if (!isBraceBlock(document, block)) {
        continue;
      }

      const openLineIndex = block.range.start.line;
      const closeLineIndex = block.range.end.line;
      if (openLineIndex + 1 <= closeLineIndex - 1) {
        markExtraBlankLinesInRange(openLineIndex + 1, closeLineIndex - 1);
      }

      if (closeLineIndex > openLineIndex) {
        markDelimiterLeadingCommentGap(openLineIndex);
        markDelimiterLeadingContentGap(openLineIndex);
      }

      if (closeLineIndex > openLineIndex) {
        markCommentAdjacentDelimiterGap(closeLineIndex);
        markContentAdjacentDelimiterGap(closeLineIndex);
      }

      for (const nestedStatement of block.statements) {
        visitStatement(nestedStatement);
      }
    }

    if (statement.kind === NodeKind.Job || statement.kind === NodeKind.Def) {
      visitDelimitedHeaderContinuation(statement.range.start.line, statement.body);
      visitDelimitedBody(statement.range.start.line, statement.body);
      return;
    }

    visitDefaultsContinuation(statement);
    visitInvocationContinuation(statement);
    visitAdditionalOutputContinuation(statement);

    const expression = statement.expression as any;
    if (expression?.kind === NodeKind.If) {
      visitIf(expression);
    }
  };

  for (const statement of program.statements) {
    visitStatement(statement);
  }

  return blankLinesToDelete;
}

function getLineText(document: TextDocument, lineIndex: number): string {
  const line = document.getText({
    start: Position.create(lineIndex, 0),
    end: Position.create(lineIndex + 1, 0),
  });
  const withoutNewline = line.endsWith("\n") ? line.slice(0, -1) : line;
  return withoutNewline.endsWith("\r") ? withoutNewline.slice(0, -1) : withoutNewline;
}

function applyDesiredIndentation(text: string, desiredIndentColumns?: number): string {
  if (desiredIndentColumns === undefined || isBlankLine(text)) {
    return text;
  }

  return `${" ".repeat(desiredIndentColumns)}${text.trimStart()}`;
}

function collectParsedProtectedCommentIndentation(
  document: TextDocument,
  desiredIndentColumns: Map<number, number>,
  blockCommentRanges: Map<number, FormattingCharacterRange[]>
): Set<number> {
  const linesAllowingProtectedIndent = new Set<number>();

  for (let lineIndex = 0; lineIndex < document.lineCount;) {
    const lineText = getLineText(document, lineIndex);
    const ranges = blockCommentRanges.get(lineIndex) ?? [];
    if (!isFullyProtectedLine(lineText, ranges)) {
      lineIndex++;
      continue;
    }

    const groupLines: number[] = [];
    while (lineIndex < document.lineCount) {
      const groupLineText = getLineText(document, lineIndex);
      const groupRanges = blockCommentRanges.get(lineIndex) ?? [];
      if (!isFullyProtectedLine(groupLineText, groupRanges)) {
        break;
      }
      groupLines.push(lineIndex);
      lineIndex++;
    }

    const anchoredIndentColumns = desiredIndentColumns.get(groupLines[0]);
    if (anchoredIndentColumns === undefined) {
      continue;
    }

    const baseIndentColumns = Math.min(
      ...groupLines
        .map((groupLine) => getLineText(document, groupLine))
        .filter((text) => !isBlankLine(text))
        .map((text) => leadingWhitespaceWidth(text))
    );

    for (const groupLine of groupLines) {
      const originalIndentColumns = leadingWhitespaceWidth(getLineText(document, groupLine));
      desiredIndentColumns.set(groupLine, anchoredIndentColumns + Math.max(0, originalIndentColumns - baseIndentColumns));
      linesAllowingProtectedIndent.add(groupLine);
    }
  }

  return linesAllowingProtectedIndent;
}

export function buildFormattingInput(document: TextDocument): FormattingInput {
  const { tokens } = lexText(document.getText());
  const { program, diagnostics } = parseText(document.getText());
  const coveredLines = collectStatementLines(program);
  const parseMode: FormattingParseMode = diagnostics.length > 0 ? "recovery" : "parsed";
  const desiredIndentColumns =
    parseMode === "parsed" ? collectParsedIndentation(document, program) : new Map<number, number>();
  const blankLinesToDelete =
    parseMode === "parsed" ? collectParsedBlankLinesToDelete(document, program) : new Set<number>();
  const diagnosticLines = collectDiagnosticLines(diagnostics);
  const syntaxProtectedRanges = parseMode === "recovery" ? collectProtectedRanges(document, tokens, diagnostics) : new Map<number, FormattingCharacterRange[]>();
  const stringLiteralRanges = collectStringLiteralRanges(document, tokens);
  const adjacentStandaloneCommentRanges =
    parseMode === "recovery" ? collectAdjacentStandaloneCommentRanges(document, syntaxProtectedRanges) : new Map<number, FormattingCharacterRange[]>();
  const blockCommentRanges = collectBlockCommentRanges(document);
  const linesAllowingProtectedIndent =
    parseMode === "parsed"
      ? collectParsedProtectedCommentIndentation(document, desiredIndentColumns, blockCommentRanges)
      : new Set<number>();
  const lines: FormattingLine[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const originalText = getLineText(document, lineIndex);
    const syntaxLineProtectedRanges =
      isBlankLine(originalText) ? [] : (syntaxProtectedRanges.get(lineIndex) ?? []);
    const lineProtectedRanges = [
      ...syntaxLineProtectedRanges,
      ...(stringLiteralRanges.get(lineIndex) ?? []),
      ...(adjacentStandaloneCommentRanges.get(lineIndex) ?? []),
      ...(blockCommentRanges.get(lineIndex) ?? []),
    ];
    const attachedCommentRange =
      parseMode === "recovery" && !isStandaloneLineComment(originalText)
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
      safeToFormat: parseMode === "parsed" || coveredLines.has(lineIndex) || lineProtectedRanges.length > 0 || attachedCommentRange !== null,
      desiredIndentColumns: desiredIndentColumns.get(lineIndex),
      allowIndentOnProtectedLine: linesAllowingProtectedIndent.has(lineIndex),
      deleteLine: blankLinesToDelete.has(lineIndex),
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
    const deleteLine = Boolean(line.deleteLine && line.lineIndex < request.endLine);
    const preservesLeadingContent = line.protectedRanges.some((range) => range.startCharacter === 0) && !line.allowIndentOnProtectedLine;
    const formattedText = line.safeToFormat
      ? (isFullyProtectedLine(line.originalText, line.protectedRanges) || preservesLeadingContent) && !line.allowIndentOnProtectedLine
        ? formatLineWithProtectedRanges(line.originalText, line.protectedRanges)
        : applyDesiredIndentation(formatLineWithProtectedRanges(line.originalText, line.protectedRanges), line.desiredIndentColumns)
      : line.originalText;
    decisions.push({
      lineIndex,
      originalText: line.originalText,
      formattedText,
      kind: line.kind,
      parseMode: input.parseMode,
      coveredBySyntax: line.coveredBySyntax,
      safeToFormat: line.safeToFormat,
      deleteLine,
    });
  }

  return decisions;
}

export function emitFormattingEdits(document: TextDocument, decisions: FormattingDecision[]): TextEdit[] {
  const edits: TextEdit[] = [];

  for (let index = 0; index < decisions.length; index++) {
    const decision = decisions[index];

    if (decision.deleteLine) {
      const deleteStartLine = decision.lineIndex;
      let deleteEndLine = decision.lineIndex;

      while (index + 1 < decisions.length && decisions[index + 1].deleteLine && decisions[index + 1].lineIndex === deleteEndLine + 1) {
        deleteEndLine = decisions[index + 1].lineIndex;
        index++;
      }

      edits.push(
        TextEdit.replace(
          Range.create(
            Position.create(deleteStartLine, 0),
            Position.create(deleteEndLine + 1, 0)
          ),
          ""
        )
      );
      continue;
    }

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
  return emitFormattingEdits(document, decisions);
}

export function formatDocumentRange(document: TextDocument, startLine: number, endLine: number): TextEdit[] {
  const input = buildFormattingInput(document);
  const decisions = planFormatting(input, { startLine, endLine });
  return emitFormattingEdits(document, decisions);
}
