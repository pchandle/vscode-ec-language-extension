"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseText = void 0;
const tokens_1 = require("./tokens");
const ast_1 = require("./ast");
const lexer_1 = require("./lexer");
function current(state) {
    return state.tokens[state.index];
}
function advance(state) {
    return state.tokens[state.index++];
}
function match(state, ...kinds) {
    if (kinds.includes(current(state).kind)) {
        advance(state);
        return true;
    }
    return false;
}
function expect(state, kind, message) {
    if (current(state).kind === kind) {
        return advance(state);
    }
    state.diagnostics.push({ message, range: current(state).range });
    return current(state);
}
function parseText(text) {
    const { tokens, diagnostics } = (0, lexer_1.lexText)(text);
    const state = { tokens, index: 0, diagnostics: [...diagnostics] };
    const statements = [];
    while (current(state).kind !== tokens_1.TokenKind.EOF) {
        // Skip stray newlines
        if (current(state).kind === tokens_1.TokenKind.Newline) {
            advance(state);
            continue;
        }
        statements.push(parseStatement(state));
    }
    const program = {
        kind: ast_1.NodeKind.Program,
        statements,
        range: {
            start: statements[0]?.range.start ?? { line: 0, character: 0 },
            end: statements[statements.length - 1]?.range.end ?? { line: 0, character: 0 },
        },
    };
    return { program, diagnostics: state.diagnostics };
}
exports.parseText = parseText;
function parseStatement(state) {
    const startTok = current(state);
    if (startTok.kind === tokens_1.TokenKind.Keyword && startTok.lexeme.toLowerCase() === "defaults") {
        return parseDefaults(state);
    }
    if (startTok.kind === tokens_1.TokenKind.Keyword && startTok.lexeme.toLowerCase() === "if") {
        const ifNode = parseIf(state);
        const stmt = {
            kind: ast_1.NodeKind.Statement,
            expression: ifNode,
            targets: ifNode.targets ?? [],
            block: undefined,
            range: ifNode.range,
        };
        return stmt;
    }
    if (startTok.kind === tokens_1.TokenKind.Keyword && startTok.lexeme.toLowerCase() === "job") {
        return parseJob(state);
    }
    if (startTok.kind === tokens_1.TokenKind.Keyword && startTok.lexeme.toLowerCase() === "def") {
        return parseDef(state);
    }
    const expr = parseExpression(state, 0);
    const targets = [];
    if (match(state, tokens_1.TokenKind.Arrow)) {
        parseTargetList(state, targets);
    }
    // Optional block following -> { ... }
    let block;
    const shouldStop = () => current(state).kind === tokens_1.TokenKind.Newline ||
        current(state).kind === tokens_1.TokenKind.EOF ||
        current(state).kind === tokens_1.TokenKind.RBrace ||
        (current(state).kind === tokens_1.TokenKind.Keyword && ["end", "else"].includes(current(state).lexeme.toLowerCase()));
    while (!shouldStop()) {
        if (current(state).kind === tokens_1.TokenKind.LBrace) {
            block = parseBraceBlock(state);
            continue;
        }
        if (current(state).kind === tokens_1.TokenKind.Arrow) {
            advance(state);
            parseTargetList(state, targets);
            continue;
        }
        if (current(state).kind === tokens_1.TokenKind.LParen) {
            consumeBalanced(state, tokens_1.TokenKind.LParen, tokens_1.TokenKind.RParen, ")", "Expected ')'");
            continue;
        }
        if (current(state).kind === tokens_1.TokenKind.Colon) {
            advance(state);
            continue;
        }
        // default: consume token
        advance(state);
    }
    // consume trailing newlines
    while (current(state).kind === tokens_1.TokenKind.Newline)
        advance(state);
    const endTok = block ? block.range : (targets[targets.length - 1]?.range ?? expr?.range ?? startTok.range);
    return {
        kind: ast_1.NodeKind.Statement,
        expression: expr,
        targets,
        block,
        range: {
            start: startTok.range.start,
            end: block ? block.range.end : endTok.end ?? endTok.start ?? startTok.range.end,
        },
    };
}
function consumeBalanced(state, open, close, closeText, errorMessage) {
    let depth = 0;
    if (current(state).kind === open) {
        advance(state);
        depth++;
    }
    while (current(state).kind !== tokens_1.TokenKind.EOF && depth > 0) {
        if (current(state).kind === open)
            depth++;
        else if (current(state).kind === close)
            depth--;
        advance(state);
    }
    if (depth !== 0) {
        state.diagnostics.push({ message: errorMessage ?? `Expected '${closeText}'`, range: current(state).range });
    }
}
function parseIf(state) {
    const ifTok = expect(state, tokens_1.TokenKind.Keyword, "Expected 'if'");
    const condition = parseExpression(state, 0);
    expect(state, tokens_1.TokenKind.Keyword, "Expected 'then'");
    const thenBlock = parseDelimitedBlock(state, ["else", "end"]);
    let elseBlock;
    if (current(state).kind === tokens_1.TokenKind.Keyword && current(state).lexeme.toLowerCase() === "else") {
        advance(state);
        elseBlock = parseDelimitedBlock(state, ["end"]);
    }
    if (!(current(state).kind === tokens_1.TokenKind.Keyword && current(state).lexeme.toLowerCase() === "end")) {
        state.diagnostics.push({ message: "Expected 'end' to close if", range: current(state).range });
    }
    else {
        advance(state);
    }
    const targets = [];
    if (match(state, tokens_1.TokenKind.Arrow)) {
        parseTargetList(state, targets);
    }
    return {
        kind: ast_1.NodeKind.If,
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
function parseParameterList(state, params) {
    expect(state, tokens_1.TokenKind.LParen, "Expected '('");
    if (current(state).kind === tokens_1.TokenKind.RParen) {
        advance(state);
        return;
    }
    while (current(state).kind !== tokens_1.TokenKind.EOF) {
        if (current(state).kind === tokens_1.TokenKind.Identifier || current(state).kind === tokens_1.TokenKind.Keyword || current(state).kind === tokens_1.TokenKind.Boolean) {
            params.push(advance(state));
        }
        else {
            state.diagnostics.push({ message: "Expected parameter name", range: current(state).range });
            advance(state);
        }
        if (current(state).kind === tokens_1.TokenKind.Comma) {
            advance(state);
            continue;
        }
        break;
    }
    expect(state, tokens_1.TokenKind.RParen, "Expected ')'");
}
function parseInlineTargets(state) {
    const targets = [];
    while (current(state).kind !== tokens_1.TokenKind.EOF) {
        if (current(state).kind === tokens_1.TokenKind.Colon) {
            advance(state);
            break;
        }
        if (current(state).kind === tokens_1.TokenKind.Newline || current(state).kind === tokens_1.TokenKind.LBrace) {
            break;
        }
        if (current(state).kind === tokens_1.TokenKind.Identifier || current(state).kind === tokens_1.TokenKind.Keyword || current(state).kind === tokens_1.TokenKind.Boolean) {
            targets.push(advance(state));
            if (current(state).kind === tokens_1.TokenKind.Comma) {
                advance(state);
                continue;
            }
            continue;
        }
        if (current(state).kind === tokens_1.TokenKind.Comma) {
            advance(state);
            continue;
        }
        break;
    }
    return targets;
}
function parseJob(state) {
    const jobTok = expect(state, tokens_1.TokenKind.Keyword, "Expected 'job'");
    let classification;
    if (current(state).kind === tokens_1.TokenKind.Classification) {
        classification = advance(state);
    }
    const params = [];
    if (current(state).kind === tokens_1.TokenKind.LParen) {
        parseParameterList(state, params);
    }
    const targets = parseInlineTargets(state);
    const body = parseDelimitedBlock(state, ["end"]);
    if (!(current(state).kind === tokens_1.TokenKind.Keyword && current(state).lexeme.toLowerCase() === "end")) {
        state.diagnostics.push({ message: "Expected 'end' to close job", range: current(state).range });
    }
    else {
        advance(state);
    }
    return {
        kind: ast_1.NodeKind.Job,
        classification,
        params,
        targets,
        body,
        range: { start: jobTok.range.start, end: body.range.end },
    };
}
function parseDef(state) {
    const defTok = expect(state, tokens_1.TokenKind.Keyword, "Expected 'def'");
    let name = defTok;
    if (current(state).kind === tokens_1.TokenKind.Identifier || current(state).kind === tokens_1.TokenKind.Keyword) {
        name = advance(state);
    }
    else {
        state.diagnostics.push({ message: "Expected identifier after 'def'", range: current(state).range });
    }
    const params = [];
    if (current(state).kind === tokens_1.TokenKind.LParen) {
        parseParameterList(state, params);
    }
    else {
        state.diagnostics.push({ message: "Expected '(' after def name", range: current(state).range });
    }
    const targets = parseInlineTargets(state);
    const body = parseDelimitedBlock(state, ["end"]);
    if (!(current(state).kind === tokens_1.TokenKind.Keyword && current(state).lexeme.toLowerCase() === "end")) {
        state.diagnostics.push({ message: "Expected 'end' to close def", range: current(state).range });
    }
    else {
        advance(state);
    }
    return {
        kind: ast_1.NodeKind.Def,
        name,
        params,
        targets,
        body,
        range: { start: defTok.range.start, end: body.range.end },
    };
}
function parseDelimitedBlock(state, endKeywords) {
    const statements = [];
    while (current(state).kind !== tokens_1.TokenKind.EOF) {
        if (current(state).kind === tokens_1.TokenKind.Keyword && endKeywords.includes(current(state).lexeme.toLowerCase())) {
            break;
        }
        if (current(state).kind === tokens_1.TokenKind.RBrace) {
            // let caller handle
            break;
        }
        if (current(state).kind === tokens_1.TokenKind.Newline) {
            advance(state);
            continue;
        }
        statements.push(parseStatement(state));
    }
    const start = statements[0]?.range.start ?? current(state).range.start;
    const end = statements[statements.length - 1]?.range.end ?? current(state).range.start;
    return {
        kind: ast_1.NodeKind.Block,
        statements,
        range: { start, end },
    };
}
function parseBraceBlock(state) {
    const lbrace = expect(state, tokens_1.TokenKind.LBrace, "Expected '{'");
    const statements = [];
    while (current(state).kind !== tokens_1.TokenKind.EOF && current(state).kind !== tokens_1.TokenKind.RBrace) {
        if (current(state).kind === tokens_1.TokenKind.Newline) {
            advance(state);
            continue;
        }
        statements.push(parseStatement(state));
    }
    const rbrace = current(state);
    if (current(state).kind === tokens_1.TokenKind.RBrace) {
        advance(state);
    }
    else {
        state.diagnostics.push({ message: "Expected '}'", range: current(state).range });
    }
    const endToken = current(state).kind === tokens_1.TokenKind.RBrace ? current(state) : rbrace;
    return {
        kind: ast_1.NodeKind.Block,
        statements,
        range: (0, ast_1.rangeFromTokens)(lbrace, endToken),
    };
}
function parseTargetList(state, targets) {
    // allow empty targets (e.g., -> { ... })
    if (current(state).kind === tokens_1.TokenKind.LBrace ||
        current(state).kind === tokens_1.TokenKind.Newline ||
        current(state).kind === tokens_1.TokenKind.EOF) {
        return;
    }
    while (true) {
        if (current(state).kind === tokens_1.TokenKind.Identifier || current(state).kind === tokens_1.TokenKind.Boolean || current(state).kind === tokens_1.TokenKind.Keyword) {
            targets.push(advance(state));
        }
        else {
            state.diagnostics.push({ message: "Expected identifier after '->'", range: current(state).range });
            break;
        }
        if (current(state).kind === tokens_1.TokenKind.Comma) {
            advance(state);
            continue;
        }
        break;
    }
}
const PRECEDENCE = {
    [tokens_1.TokenKind.Percent]: 2,
    [tokens_1.TokenKind.Star]: 3,
    [tokens_1.TokenKind.Slash]: 3,
    [tokens_1.TokenKind.Minus]: 4,
    [tokens_1.TokenKind.Plus]: 4,
    [tokens_1.TokenKind.GreaterThan]: 5,
    [tokens_1.TokenKind.LessThan]: 5,
    [tokens_1.TokenKind.GreaterEquals]: 5,
    [tokens_1.TokenKind.LessEquals]: 5,
    [tokens_1.TokenKind.EqualsEquals]: 6,
    [tokens_1.TokenKind.BangEquals]: 6,
    [tokens_1.TokenKind.AndAnd]: 7,
    [tokens_1.TokenKind.OrOr]: 8,
};
function getPrecedence(token) {
    return PRECEDENCE[token.kind] ?? 0;
}
function parseExpression(state, minPrec) {
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
            kind: ast_1.NodeKind.Binary,
            operator: tok,
            left: expr,
            right: rhs,
            range: { start: expr.range.start, end: rhs.range.end },
        };
    }
    return expr;
}
function parseUnary(state) {
    const tok = current(state);
    if (tok.kind === tokens_1.TokenKind.Bang || tok.kind === tokens_1.TokenKind.Minus || tok.kind === tokens_1.TokenKind.Plus) {
        advance(state);
        const operand = parseUnary(state);
        if (!operand) {
            state.diagnostics.push({ message: "Expected expression after unary operator", range: tok.range });
            return {
                kind: ast_1.NodeKind.Unary,
                operator: tok,
                operand: {
                    kind: ast_1.NodeKind.Identifier,
                    token: tok,
                    range: tok.range,
                },
                range: tok.range,
            };
        }
        return {
            kind: ast_1.NodeKind.Unary,
            operator: tok,
            operand,
            range: { start: tok.range.start, end: operand.range.end },
        };
    }
    return parsePostfix(state);
}
function parsePostfix(state) {
    let expr = parsePrimary(state);
    if (!expr)
        return null;
    // Optional supplier qualification
    if (current(state).kind === tokens_1.TokenKind.At && state.tokens[state.index + 1]?.kind === tokens_1.TokenKind.Supplier) {
        const at = advance(state);
        const supplier = advance(state);
        expr = {
            kind: ast_1.NodeKind.Qualified,
            base: expr,
            supplier,
            range: { start: expr.range.start, end: supplier.range.end },
        };
    }
    // Call expressions
    while (current(state).kind === tokens_1.TokenKind.LParen) {
        const lparen = advance(state);
        const args = [];
        if (current(state).kind !== tokens_1.TokenKind.RParen) {
            while (true) {
                const arg = parseExpression(state, 0);
                if (arg) {
                    args.push(arg);
                }
                else {
                    state.diagnostics.push({ message: "Expected expression in argument list", range: current(state).range });
                }
                if (current(state).kind === tokens_1.TokenKind.Comma) {
                    // detect trailing comma before ')'
                    if (state.tokens[state.index + 1]?.kind === tokens_1.TokenKind.RParen) {
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
        const rparen = expect(state, tokens_1.TokenKind.RParen, "Expected ')'");
        expr = {
            kind: ast_1.NodeKind.Call,
            callee: expr,
            args,
            range: { start: expr.range.start, end: rparen.range.end },
        };
    }
    return expr;
}
function parsePrimary(state) {
    const tok = current(state);
    switch (tok.kind) {
        case tokens_1.TokenKind.Integer:
        case tokens_1.TokenKind.String:
        case tokens_1.TokenKind.Boolean: {
            advance(state);
            const node = { kind: ast_1.NodeKind.Literal, token: tok, range: tok.range };
            return node;
        }
        case tokens_1.TokenKind.Identifier:
        case tokens_1.TokenKind.Keyword: {
            advance(state);
            const node = { kind: ast_1.NodeKind.Identifier, token: tok, range: tok.range };
            return node;
        }
        case tokens_1.TokenKind.Classification: {
            advance(state);
            const node = { kind: ast_1.NodeKind.Classification, token: tok, range: tok.range };
            return node;
        }
        case tokens_1.TokenKind.Scope: {
            advance(state);
            const node = { kind: ast_1.NodeKind.Scope, token: tok, range: tok.range };
            return node;
        }
        case tokens_1.TokenKind.LParen: {
            const l = advance(state);
            const inner = parseExpression(state, 0);
            const r = expect(state, tokens_1.TokenKind.RParen, "Expected ')'");
            const range = { start: l.range.start, end: r.range.end };
            return inner ?? { kind: ast_1.NodeKind.Literal, token: l, range };
        }
        default:
            state.diagnostics.push({ message: `Unexpected token '${tok.lexeme || tok.kind}'`, range: tok.range });
            advance(state);
            return null;
    }
}
function parseDefaults(state) {
    const start = advance(state); // consume 'defaults'
    if (current(state).kind === tokens_1.TokenKind.Colon) {
        advance(state);
    }
    // collect entries until newline/EOF
    while (current(state).kind !== tokens_1.TokenKind.EOF && current(state).kind !== tokens_1.TokenKind.Newline) {
        if (current(state).kind === tokens_1.TokenKind.Comma) {
            advance(state);
            continue;
        }
        if (current(state).kind === tokens_1.TokenKind.Identifier ||
            current(state).kind === tokens_1.TokenKind.Keyword ||
            current(state).kind === tokens_1.TokenKind.Classification) {
            advance(state);
            continue;
        }
        // anything else is unexpected but continue
        state.diagnostics.push({ message: `Unexpected token '${current(state).lexeme}' in defaults`, range: current(state).range });
        advance(state);
    }
    if (current(state).kind === tokens_1.TokenKind.Newline) {
        advance(state);
    }
    return {
        kind: ast_1.NodeKind.Statement,
        expression: null,
        targets: [],
        range: { start: start.range.start, end: current(state).range.start },
    };
}
//# sourceMappingURL=parser.js.map