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

  const expr = parseExpression(state, 0);
  const targets: Token[] = [];
  if (match(state, TokenKind.Arrow)) {
    parseTargetList(state, targets);
  }

  // Optional block following -> { ... }
  let block: BlockNode | undefined;

  const shouldStop = () =>
    current(state).kind === TokenKind.Newline ||
    current(state).kind === TokenKind.EOF ||
    current(state).kind === TokenKind.RBrace ||
    (current(state).kind === TokenKind.Keyword && ["end", "else"].includes(current(state).lexeme.toLowerCase()));

  while (!shouldStop()) {
    if (current(state).kind === TokenKind.LBrace) {
      block = parseBraceBlock(state);
      continue;
    }
    if (current(state).kind === TokenKind.Arrow) {
      advance(state);
      parseTargetList(state, targets);
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

  const endTok = block ? block.range : (targets[targets.length - 1]?.range ?? expr?.range ?? startTok.range);
  return {
    kind: NodeKind.Statement,
    expression: expr,
    targets,
    block,
    range: {
      start: startTok.range.start,
      end: block ? block.range.end : endTok.end ?? endTok.start ?? startTok.range.end,
    },
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

  return {
    kind: NodeKind.If,
    condition,
    thenBlock,
    elseBlock,
    targets,
    range: {
      start: ifTok.range.start,
      end: (elseBlock ?? thenBlock).range.end,
    },
  };
}

function parseParameterList(state: ParserState, params: Token[]) {
  expect(state, TokenKind.LParen, "Expected '('");
  if (current(state).kind === TokenKind.RParen) {
    advance(state);
    return;
  }
  while (current(state).kind !== TokenKind.EOF) {
    if (current(state).kind === TokenKind.Identifier || current(state).kind === TokenKind.Keyword || current(state).kind === TokenKind.Boolean) {
      params.push(advance(state));
    } else {
      state.diagnostics.push({ message: "Expected parameter name", range: current(state).range });
      advance(state);
    }
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      continue;
    }
    break;
  }
  expect(state, TokenKind.RParen, "Expected ')'");
}

function parseInlineTargets(state: ParserState): Token[] {
  const targets: Token[] = [];
  while (current(state).kind !== TokenKind.EOF) {
    if (current(state).kind === TokenKind.Colon) {
      advance(state);
      break;
    }
    if (current(state).kind === TokenKind.Newline || current(state).kind === TokenKind.LBrace) {
      break;
    }
    if (current(state).kind === TokenKind.Identifier || current(state).kind === TokenKind.Keyword || current(state).kind === TokenKind.Boolean) {
      targets.push(advance(state));
      if (current(state).kind === TokenKind.Comma) {
        advance(state);
        continue;
      }
      continue;
    }
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
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
  const targets = parseInlineTargets(state);
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

function parseTargetList(state: ParserState, targets: Token[]) {
  // allow empty targets (e.g., -> { ... })
  if (
    current(state).kind === TokenKind.LBrace ||
    current(state).kind === TokenKind.Newline ||
    current(state).kind === TokenKind.EOF
  ) {
    return;
  }
  while (true) {
    if (current(state).kind === TokenKind.Identifier || current(state).kind === TokenKind.Boolean || current(state).kind === TokenKind.Keyword) {
      targets.push(advance(state));
    } else {
      state.diagnostics.push({ message: "Expected identifier after '->'", range: current(state).range });
      break;
    }
    if (current(state).kind === TokenKind.Comma) {
      advance(state);
      continue;
    }
    break;
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
  let expr = parseUnary(state);
  while (true) {
    const tok = current(state);
    const prec = getPrecedence(tok);
    if (prec === 0 || prec < minPrec) {
      break;
    }
    advance(state);
    const rhs = parseExpression(state, prec + 1);
    if (!expr || !rhs) {
      break;
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
    const lparen = advance(state);
    const args: ExpressionNode[] = [];
    if (current(state).kind !== TokenKind.RParen) {
      while (true) {
        const arg = parseExpression(state, 0);
        if (arg) {
          args.push(arg);
        } else {
          state.diagnostics.push({ message: "Expected expression in argument list", range: current(state).range });
        }
        if (current(state).kind === TokenKind.Comma) {
          // detect trailing comma before ')'
          if (state.tokens[state.index + 1]?.kind === TokenKind.RParen) {
            state.diagnostics.push({ message: "Trailing comma not allowed in argument list", range: current(state).range });
            advance(state); // consume comma
            break;
          }
          advance(state);
          continue;
        }
        break;
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
    case TokenKind.LParen: {
      const l = advance(state);
      const inner = parseExpression(state, 0);
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
