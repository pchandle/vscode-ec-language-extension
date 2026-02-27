import { SyntaxDiagnostic, Token, TokenKind } from "./tokens";
import {
  BinaryNode,
  BlockNode,
  IdentifierNode,
  IfNode,
  LiteralNode,
  NodeKind,
  ProgramNode,
  StatementNode,
  JobNode,
  DefNode,
  Statement,
  UnaryNode,
  ExpressionNode,
  ClassificationNode,
  rangeFromTokens,
  ScopeRefNode,
  QualifiedNode,
  CallNode,
} from "./ast";
import { lexText } from "./lexer";

type ParserState = {
  tokens: Token[];
  index: number;
  diagnostics: SyntaxDiagnostic[];
};

function current(state: ParserState): Token {
  return state.tokens[state.index];
}

function advance(state: ParserState): Token {
  return state.tokens[state.index++];
}

function match(state: ParserState, ...kinds: TokenKind[]): boolean {
  if (kinds.includes(current(state).kind)) {
    advance(state);
    return true;
  }
  return false;
}

function expect(state: ParserState, kind: TokenKind, message: string) {
  if (current(state).kind === kind) {
    return advance(state);
  }
  state.diagnostics.push({ message, range: current(state).range });
  return current(state);
}

function skipNewlines(state: ParserState) {
  while (current(state).kind === TokenKind.Newline) {
    advance(state);
  }
}

export function parseText(text: string): { program: ProgramNode; diagnostics: SyntaxDiagnostic[] } {
  const { tokens, diagnostics } = lexText(text);
  const state: ParserState = { tokens, index: 0, diagnostics: [...diagnostics] };
  const statements: Statement[] = [];

  while (current(state).kind !== TokenKind.EOF) {
    // Skip stray newlines
    if (current(state).kind === TokenKind.Newline) {
      advance(state);
      continue;
    }
    statements.push(parseStatement(state));
  }

  const program: ProgramNode = {
    kind: NodeKind.Program,
    statements,
    range: {
      start: statements[0]?.range.start ?? { line: 0, character: 0 },
      end: statements[statements.length - 1]?.range.end ?? { line: 0, character: 0 },
    },
  };

  return { program, diagnostics: state.diagnostics };
}

function parseStatement(state: ParserState): Statement {
  const startTok = current(state);
  if (startTok.kind === TokenKind.Keyword && startTok.lexeme.toLowerCase() === "defaults") {
    return parseDefaults(state);
  }
  if (startTok.kind === TokenKind.Keyword && startTok.lexeme.toLowerCase() === "if") {
    const ifNode = parseIf(state);
    const stmt: StatementNode = {
      kind: NodeKind.Statement,
      expression: ifNode as any,
      targets: ifNode.targets ?? [],
      block: undefined,
      range: ifNode.range,
    };
    return stmt;
  }
  if (startTok.kind === TokenKind.Keyword && startTok.lexeme.toLowerCase() === "job") {
    return parseJob(state);
  }
  if (startTok.kind === TokenKind.Keyword && startTok.lexeme.toLowerCase() === "def") {
    return parseDef(state);
  }

  if (
    startTok.kind === TokenKind.Keyword &&
    ["sub", "host", "join"].includes(startTok.lexeme.toLowerCase())
  ) {
    const parsedInvocation = parseInvocationStatement(state);
    if (parsedInvocation) {
      return parsedInvocation;
    }
  }

  const expr = parseExpression(state, 0);
  return parseGenericStatement(state, startTok, expr);
}

function parseInvocationStatement(state: ParserState): StatementNode | null {
  const keywordTok = current(state);
  const startIndex = state.index;
  advance(state); // consume sub/host/join keyword

  if (!(current(state).kind === TokenKind.Classification || looksLikeRelativeClassification(state))) {
    state.index = startIndex;
    return null;
  }

  const expr: IdentifierNode = {
    kind: NodeKind.Identifier,
    token: keywordTok,
    range: keywordTok.range,
  };

  const targets: Token[] = [];
  const obligationOrder: Array<Token | BlockNode> = [];
  const callArgs: ExpressionNode[] = [];
  let supplier: Token | undefined;
  const classification = current(state).kind === TokenKind.Classification ? advance(state) : parseRelativeClassification(state);

  if (current(state).kind === TokenKind.At) {
    advance(state);
    if (current(state).kind === TokenKind.Supplier) {
      supplier = advance(state);
    }
  }
  if (current(state).kind === TokenKind.LParen) {
    parseArgumentList(state, callArgs);
  }

  if (match(state, TokenKind.Arrow)) {
    parseTargetList(state, targets, obligationOrder);
  }

  return finalizeStatement(state, keywordTok, expr, targets, obligationOrder, callArgs, supplier, classification);
}

function parseGenericStatement(state: ParserState, startTok: Token, expr: ExpressionNode | null): StatementNode {
  const targets: Token[] = [];
  const obligationOrder: Array<Token | BlockNode> = [];
  const callArgs: ExpressionNode[] = [];
  let supplier: Token | undefined;
  if (match(state, TokenKind.Arrow)) {
    parseTargetList(state, targets, obligationOrder);
  }

  const classification: Token | undefined = undefined;
  return finalizeStatement(state, startTok, expr, targets, obligationOrder, callArgs, supplier, classification);
}

function finalizeStatement(
  state: ParserState,
  startTok: Token,
  expr: ExpressionNode | null,
  targets: Token[],
  obligationOrder: Array<Token | BlockNode>,
  callArgs: ExpressionNode[],
  supplier?: Token,
  classification?: Token
): StatementNode {
  // Optional block following -> { ... }
  let block: BlockNode | undefined;
  let seenBlock = false;

  const shouldStop = () =>
    current(state).kind === TokenKind.Newline ||
    current(state).kind === TokenKind.EOF ||
    current(state).kind === TokenKind.RBrace ||
    (current(state).kind === TokenKind.Keyword && ["end", "else"].includes(current(state).lexeme.toLowerCase()));

  while (!shouldStop()) {
    if (current(state).kind === TokenKind.LBrace) {
      block = parseBraceBlock(state);
      obligationOrder.push(block);
      seenBlock = true;
      continue;
    }
    if (
      seenBlock &&
      (current(state).kind === TokenKind.Identifier ||
        current(state).kind === TokenKind.Keyword ||
        current(state).kind === TokenKind.Boolean ||
        current(state).kind === TokenKind.Comma)
    ) {
      parseTargetList(state, targets, obligationOrder);
      continue;
    }
    if (current(state).kind === TokenKind.Arrow) {
      advance(state);
      parseTargetList(state, targets, obligationOrder);
      continue;
    }
    if (current(state).kind === TokenKind.LParen) {
      consumeBalanced(state, TokenKind.LParen, TokenKind.RParen, ")", "Expected ')'");
      continue;
    }
    if (current(state).kind === TokenKind.Colon) {
      advance(state);
      continue;
    }
    // default: consume token
    advance(state);
  }

  // consume trailing newlines
  while (current(state).kind === TokenKind.Newline) advance(state);

  const lastObligation = obligationOrder.length ? obligationOrder[obligationOrder.length - 1] : undefined;
  const endRange =
    (lastObligation as any)?.range ??
    (targets[targets.length - 1]?.range ??
      (block ? block.range : undefined) ??
      (expr?.range ?? startTok.range));
  return {
    kind: NodeKind.Statement,
    expression: expr,
    targets,
    keyword: startTok,
    supplier,
    callArgs: callArgs.length ? callArgs : undefined,
    obligationOrder: obligationOrder.length ? obligationOrder : undefined,
    block,
    classification,
    range: {
      start: startTok.range.start,
      end: endRange.end ?? endRange.start ?? startTok.range.end,
    },
  };
}

function isClassificationSegment(kind: TokenKind): boolean {
  return kind === TokenKind.Identifier || kind === TokenKind.Keyword || kind === TokenKind.Boolean;
}

function looksLikeRelativeClassification(state: ParserState): boolean {
  const first = current(state);
  if (!isClassificationSegment(first.kind)) return false;
  let i = state.index + 1;
  let sawSlash = false;
  while (state.tokens[i]?.kind === TokenKind.Slash) {
    if (!isClassificationSegment(state.tokens[i + 1]?.kind)) break;
    sawSlash = true;
    i += 2;
  }
  return sawSlash;
}

function parseRelativeClassification(state: ParserState): Token {
  const start = current(state);
  let end = start;
  let lexeme = "";
  while (current(state).kind !== TokenKind.EOF) {
    if (isClassificationSegment(current(state).kind)) {
      const tok = advance(state);
      lexeme += tok.lexeme;
      end = tok;
      continue;
    }
    if (current(state).kind === TokenKind.Slash && isClassificationSegment(state.tokens[state.index + 1]?.kind)) {
      const slash = advance(state);
      lexeme += slash.lexeme;
      end = slash;
      continue;
    }
    break;
  }
  return {
    kind: TokenKind.Classification,
    lexeme,
    range: { start: start.range.start, end: end.range.end },
  };
}

function consumeBalanced(
  state: ParserState,
  open: TokenKind,
  close: TokenKind,
  closeText: string,
  errorMessage: string
) {
  let depth = 0;
  if (current(state).kind === open) {
    advance(state);
    depth++;
  }
  while (current(state).kind !== TokenKind.EOF && depth > 0) {
    if (current(state).kind === open) depth++;
    else if (current(state).kind === close) depth--;
    advance(state);
  }
  if (depth !== 0) {
    state.diagnostics.push({ message: errorMessage ?? `Expected '${closeText}'`, range: current(state).range });
  }
}

function parseIf(state: ParserState): IfNode {
  const ifTok = expect(state, TokenKind.Keyword, "Expected 'if'");
  const condition = parseExpression(state, 0);
  expect(state, TokenKind.Keyword, "Expected 'then'");
  const thenBlock = parseDelimitedBlock(state, ["else", "end"]);
  let elseBlock: BlockNode | undefined;
  if (current(state).kind === TokenKind.Keyword && current(state).lexeme.toLowerCase() === "else") {
    advance(state);
    elseBlock = parseDelimitedBlock(state, ["end"]);
  }
  if (!(current(state).kind === TokenKind.Keyword && current(state).lexeme.toLowerCase() === "end")) {
    state.diagnostics.push({ message: "Expected 'end' to close if", range: current(state).range });
  } else {
    advance(state);
  }

  const targets: Token[] = [];
  if (match(state, TokenKind.Arrow)) {
    parseTargetList(state, targets);
  }

  const endRange = targets[targets.length - 1]?.range ?? (elseBlock ?? thenBlock).range;

  return {
    kind: NodeKind.If,
    condition,
    thenBlock,
    elseBlock,
    targets,
    range: {
      start: ifTok.range.start,
      end: endRange.end,
    },
  };
}

function parseParameterList(state: ParserState, params: Token[]) {
  expect(state, TokenKind.LParen, "Expected '('");
  skipNewlines(state);
  if (current(state).kind === TokenKind.RParen) {
    advance(state);
    return;
  }
  while (current(state).kind !== TokenKind.EOF) {
    skipNewlines(state);
    if (current(state).kind === TokenKind.RParen) {
      advance(state);
      return;
    }
    if (current(state).kind === TokenKind.Identifier || current(state).kind === TokenKind.Keyword || current(state).kind === TokenKind.Boolean) {
      params.push(advance(state));
    } else {
      state.diagnostics.push({ message: "Expected parameter name", range: current(state).range });
      advance(state);
    }
    skipNewlines(state);
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      skipNewlines(state);
      continue;
    }
    if (current(state).kind === TokenKind.RParen) {
      advance(state);
      return;
    }
    break;
  }
  expect(state, TokenKind.RParen, "Expected ')'");
}

function parseArgumentList(state: ParserState, args: ExpressionNode[]) {
  expect(state, TokenKind.LParen, "Expected '('");
  skipNewlines(state);
  if (current(state).kind === TokenKind.RParen) {
    advance(state);
    return;
  }
  while (current(state).kind !== TokenKind.EOF) {
    skipNewlines(state);
    if (current(state).kind === TokenKind.RParen) {
      advance(state);
      return;
    }
    const expr = parseExpression(state, 0);
    if (expr) args.push(expr);
    skipNewlines(state);
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      skipNewlines(state);
      continue;
    }
    if (current(state).kind === TokenKind.RParen) {
      advance(state);
      return;
    }
    break;
  }
  expect(state, TokenKind.RParen, "Expected ')'");
}

function parseInlineTargets(
  state: ParserState,
  options?: { consumeColon?: boolean; allowNewlines?: boolean }
): Token[] {
  const consumeColon = options?.consumeColon ?? true;
  const allowNewlines = options?.allowNewlines ?? false;
  const targets: Token[] = [];
  const reserved = new Set(["sub", "job", "host", "join", "def", "if", "deliver"]);
  let newlineContinuation = false;
  while (current(state).kind !== TokenKind.EOF) {
    if (current(state).kind === TokenKind.Colon) {
      if (consumeColon) {
        advance(state);
      }
      break;
    }
    if (current(state).kind === TokenKind.Arrow) {
      advance(state);
      continue;
    }
    if (current(state).kind === TokenKind.Newline) {
      if (allowNewlines) {
        advance(state);
        if (newlineContinuation || current(state).kind === TokenKind.Colon) {
          newlineContinuation = false;
          continue;
        }
      }
      // Inline targets are only valid before the statement body starts.
      // Newlines terminate the inline-target scan unless explicitly allowed.
      break;
    }
    if (current(state).kind === TokenKind.LBrace) {
      break;
    }
    if (
      current(state).kind === TokenKind.Identifier ||
      current(state).kind === TokenKind.Boolean ||
      (current(state).kind === TokenKind.Keyword && !reserved.has(current(state).lexeme.toLowerCase()))
    ) {
      targets.push(advance(state));
      newlineContinuation = false;
      if (current(state).kind === TokenKind.Comma) {
        advance(state);
        newlineContinuation = true;
      }
      continue;
    }
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      newlineContinuation = true;
      continue;
    }
    break;
  }
  return targets;
}

function parseJob(state: ParserState): JobNode {
  const jobTok = expect(state, TokenKind.Keyword, "Expected 'job'");
  let classification: Token | undefined;
  if (current(state).kind === TokenKind.Classification) {
    classification = advance(state);
  }
  const params: Token[] = [];
  if (current(state).kind === TokenKind.LParen) {
    parseParameterList(state, params);
  }
  const targets = parseInlineTargets(state, { consumeColon: false, allowNewlines: true });
  expect(state, TokenKind.Colon, "Expected ':' after job signature");
  const body = parseDelimitedBlock(state, ["end"]);
  if (!(current(state).kind === TokenKind.Keyword && current(state).lexeme.toLowerCase() === "end")) {
    state.diagnostics.push({ message: "Expected 'end' to close job", range: current(state).range });
  } else {
    advance(state);
  }
  return {
    kind: NodeKind.Job,
    classification,
    params,
    targets,
    body,
    range: { start: jobTok.range.start, end: body.range.end },
  };
}

function parseDef(state: ParserState): DefNode {
  const defTok = expect(state, TokenKind.Keyword, "Expected 'def'");
  let name = defTok;
  if (current(state).kind === TokenKind.Identifier || current(state).kind === TokenKind.Keyword) {
    name = advance(state);
  } else {
    state.diagnostics.push({ message: "Expected identifier after 'def'", range: current(state).range });
  }
  const params: Token[] = [];
  if (current(state).kind === TokenKind.LParen) {
    parseParameterList(state, params);
  } else {
    state.diagnostics.push({ message: "Expected '(' after def name", range: current(state).range });
  }
  const targets = parseInlineTargets(state);
  const body = parseDelimitedBlock(state, ["end"]);
  if (!(current(state).kind === TokenKind.Keyword && current(state).lexeme.toLowerCase() === "end")) {
    state.diagnostics.push({ message: "Expected 'end' to close def", range: current(state).range });
  } else {
    advance(state);
  }
  return {
    kind: NodeKind.Def,
    name,
    params,
    targets,
    body,
    range: { start: defTok.range.start, end: body.range.end },
  };
}

function parseDelimitedBlock(state: ParserState, endKeywords: string[]): BlockNode {
  const statements: Statement[] = [];

  while (current(state).kind !== TokenKind.EOF) {
    if (current(state).kind === TokenKind.Keyword && endKeywords.includes(current(state).lexeme.toLowerCase())) {
      break;
    }
    if (current(state).kind === TokenKind.RBrace) {
      // let caller handle
      break;
    }
    if (current(state).kind === TokenKind.Newline) {
      advance(state);
      continue;
    }
    statements.push(parseStatement(state));
  }

  const start = statements[0]?.range.start ?? current(state).range.start;
  const end = statements[statements.length - 1]?.range.end ?? current(state).range.start;
  return {
    kind: NodeKind.Block,
    statements,
    range: { start, end },
  };
}

function parseBraceBlock(state: ParserState): BlockNode {
  const lbrace = expect(state, TokenKind.LBrace, "Expected '{'");
  const statements: Statement[] = [];
  while (current(state).kind !== TokenKind.EOF && current(state).kind !== TokenKind.RBrace) {
    if (current(state).kind === TokenKind.Newline) {
      advance(state);
      continue;
    }
    statements.push(parseStatement(state));
  }
  const rbrace = current(state);
  if (current(state).kind === TokenKind.RBrace) {
    advance(state);
  } else {
    state.diagnostics.push({ message: "Expected '}'", range: current(state).range });
  }
  const endToken = current(state).kind === TokenKind.RBrace ? current(state) : rbrace;
  return {
    kind: NodeKind.Block,
    statements,
    range: rangeFromTokens(lbrace, endToken),
  };
}

function parseTargetList(state: ParserState, targets: Token[], order?: Array<Token | BlockNode>) {
  // allow empty targets (e.g., -> { ... })
  if (
    current(state).kind === TokenKind.LBrace ||
    current(state).kind === TokenKind.Newline ||
    current(state).kind === TokenKind.EOF
  ) {
    return;
  }
  // Trailing commas indicate continuation, including across newlines.
  const consumeContinuationNewlines = () => {
    while (current(state).kind === TokenKind.Newline) {
      advance(state);
    }
  };

  while (current(state).kind === TokenKind.Comma) {
    advance(state);
    consumeContinuationNewlines();
  }

  let readingTargets = true;
  while (readingTargets) {
    // Stop if the next obligation is a braced block; caller will parse it.
    if (current(state).kind === TokenKind.LBrace || current(state).kind === TokenKind.Newline || current(state).kind === TokenKind.EOF) {
      return;
    }
    if (current(state).kind === TokenKind.Identifier || current(state).kind === TokenKind.Boolean || current(state).kind === TokenKind.Keyword) {
      const tok = advance(state);
      targets.push(tok);
      if (order) order.push(tok);
    } else {
      state.diagnostics.push({ message: "Expected identifier after '->'", range: current(state).range });
      break;
    }
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      consumeContinuationNewlines();
      continue;
    }
    readingTargets = false;
  }
}

const PRECEDENCE: Partial<Record<TokenKind, number>> = {
  [TokenKind.OrOr]: 1,
  [TokenKind.AndAnd]: 2,
  [TokenKind.EqualsEquals]: 3,
  [TokenKind.BangEquals]: 3,
  [TokenKind.GreaterThan]: 4,
  [TokenKind.LessThan]: 4,
  [TokenKind.GreaterEquals]: 4,
  [TokenKind.LessEquals]: 4,
  [TokenKind.Minus]: 5,
  [TokenKind.Plus]: 5,
  [TokenKind.Percent]: 6,
  [TokenKind.Star]: 6,
  [TokenKind.Slash]: 6,
};

function getPrecedence(token: Token): number {
  return PRECEDENCE[token.kind] ?? 0;
}

function parseExpression(state: ParserState, minPrec: number): ExpressionNode | null {
  skipNewlines(state);
  let expr = parseUnary(state);
  let parsing = true;
  while (parsing) {
    skipNewlines(state);
    const tok = current(state);
    const prec = getPrecedence(tok);
    if (prec === 0 || prec < minPrec) {
      parsing = false;
      continue;
    }
    advance(state);
    skipNewlines(state);
    const rhs = parseExpression(state, prec + 1);
    if (!expr || !rhs) {
      parsing = false;
      continue;
    }
    expr = {
      kind: NodeKind.Binary,
      operator: tok,
      left: expr,
      right: rhs!,
      range: { start: expr.range.start, end: rhs!.range.end },
    };
  }
  return expr;
}

function parseUnary(state: ParserState): ExpressionNode | null {
  const tok = current(state);
  if (tok.kind === TokenKind.Bang || tok.kind === TokenKind.Minus || tok.kind === TokenKind.Plus) {
    advance(state);
    const operand = parseUnary(state);
    if (!operand) {
      state.diagnostics.push({ message: "Expected expression after unary operator", range: tok.range });
      return {
        kind: NodeKind.Unary,
        operator: tok,
        operand: {
          kind: NodeKind.Identifier,
          token: tok,
          range: tok.range,
        },
        range: tok.range,
      };
    }
    return {
      kind: NodeKind.Unary,
      operator: tok,
      operand,
      range: { start: tok.range.start, end: operand.range.end },
    };
  }
  return parsePostfix(state);
}

function parsePostfix(state: ParserState): ExpressionNode | null {
  let expr = parsePrimary(state);
  if (!expr) return null;

  // Optional supplier qualification
  if (current(state).kind === TokenKind.At && state.tokens[state.index + 1]?.kind === TokenKind.Supplier) {
    const at = advance(state);
    const supplier = advance(state);
    expr = {
      kind: NodeKind.Qualified,
      base: expr,
      supplier,
      range: { start: expr.range.start, end: supplier.range.end },
    } as QualifiedNode;
  }

  // Call expressions
  while (current(state).kind === TokenKind.LParen) {
    advance(state);
    const args: ExpressionNode[] = [];
    skipNewlines(state);
    if (current(state).kind !== TokenKind.RParen) {
      let parsingArgs = true;
      while (parsingArgs) {
        skipNewlines(state);
        if (current(state).kind === TokenKind.RParen) {
          break;
        }
        const arg = parseExpression(state, 0);
        if (arg) {
          args.push(arg);
        } else {
          state.diagnostics.push({ message: "Expected expression in argument list", range: current(state).range });
        }
        skipNewlines(state);
        if (current(state).kind === TokenKind.Comma) {
          // detect trailing comma before ')'
          let lookahead = state.index + 1;
          while (state.tokens[lookahead]?.kind === TokenKind.Newline) {
            lookahead++;
          }
          if (state.tokens[lookahead]?.kind === TokenKind.RParen) {
            state.diagnostics.push({ message: "Trailing comma not allowed in argument list", range: current(state).range });
            advance(state); // consume comma
            parsingArgs = false;
            continue;
          }
          advance(state);
          continue;
        }
        parsingArgs = false;
      }
    }
    const rparen = expect(state, TokenKind.RParen, "Expected ')'");
    expr = {
      kind: NodeKind.Call,
      callee: expr,
      args,
      range: { start: expr.range.start, end: rparen.range.end },
    } as CallNode;
  }

  return expr;
}

function parsePrimary(state: ParserState): ExpressionNode | null {
  const tok = current(state);
  switch (tok.kind) {
    case TokenKind.Integer:
    case TokenKind.String:
    case TokenKind.Boolean: {
      advance(state);
      const node: LiteralNode = { kind: NodeKind.Literal, token: tok, range: tok.range };
      return node;
    }
    case TokenKind.Identifier:
    case TokenKind.Keyword: {
      advance(state);
      const node: IdentifierNode = { kind: NodeKind.Identifier, token: tok, range: tok.range };
      return node;
    }
    case TokenKind.Classification: {
      advance(state);
      const node: ClassificationNode = { kind: NodeKind.Classification, token: tok, range: tok.range };
      return node;
    }
    case TokenKind.Scope: {
      advance(state);
      const node: ScopeRefNode = { kind: NodeKind.Scope, token: tok, range: tok.range };
      return node;
    }
    case TokenKind.LBracket: {
      const l = advance(state);
      const elements: ExpressionNode[] = [];
      skipNewlines(state);
      if (current(state).kind !== TokenKind.RBracket) {
        while (current(state).kind !== TokenKind.EOF) {
          skipNewlines(state);
          const elem = parseExpression(state, 0);
          if (elem) {
            elements.push(elem);
          } else {
            state.diagnostics.push({ message: "Expected expression in list", range: current(state).range });
          }
          skipNewlines(state);
          if (current(state).kind === TokenKind.Comma) {
            advance(state);
            continue;
          }
          break;
        }
      }
      const r = expect(state, TokenKind.RBracket, "Expected ']'");
      const range = { start: l.range.start, end: r.range.end };
      return { kind: NodeKind.ListLiteral, elements, range } as any;
    }
    case TokenKind.LParen: {
      const l = advance(state);
      skipNewlines(state);
      const inner = parseExpression(state, 0);
      skipNewlines(state);
      const r = expect(state, TokenKind.RParen, "Expected ')'");
      const range = { start: l.range.start, end: r.range.end };
      return inner ?? ({ kind: NodeKind.Literal, token: l, range } as any);
    }
    default:
      state.diagnostics.push({ message: `Unexpected token '${tok.lexeme || tok.kind}'`, range: tok.range });
      advance(state);
      return null;
  }
}

function parseDefaults(state: ParserState): StatementNode {
  const start = advance(state); // consume 'defaults'
  if (current(state).kind === TokenKind.Colon) {
    advance(state);
  }
  // collect entries until newline/EOF
  while (current(state).kind !== TokenKind.EOF && current(state).kind !== TokenKind.Newline) {
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      continue;
    }
    if (
      current(state).kind === TokenKind.Identifier ||
      current(state).kind === TokenKind.Keyword ||
      current(state).kind === TokenKind.Classification
    ) {
      advance(state);
      continue;
    }
    // anything else is unexpected but continue
    state.diagnostics.push({ message: `Unexpected token '${current(state).lexeme}' in defaults`, range: current(state).range });
    advance(state);
  }
  if (current(state).kind === TokenKind.Newline) {
    advance(state);
  }
  return {
    kind: NodeKind.Statement,
    expression: null,
    targets: [],
    range: { start: start.range.start, end: current(state).range.start },
  };
}
