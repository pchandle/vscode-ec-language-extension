"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lexText = void 0;
const tokens_1 = require("./tokens");
function currentChar(state) {
    return state.text[state.offset];
}
function advance(state, count = 1) {
    for (let i = 0; i < count; i++) {
        const ch = state.text[state.offset++];
        if (ch === "\n") {
            state.line += 1;
            state.column = 0;
        }
        else {
            state.column += 1;
        }
    }
}
function makeRange(state, startOffset, startLine, startCol) {
    return {
        start: { line: startLine, character: startCol },
        end: { line: state.line, character: state.column },
    };
}
function addToken(state, kind, lexeme, startOffset, startLine, startCol) {
    state.tokens.push({
        kind,
        lexeme,
        range: makeRange(state, startOffset, startLine, startCol),
    });
}
function isIdentifierStart(ch) {
    return /[A-Za-z_]/.test(ch);
}
function isIdentifierPart(ch) {
    return /[A-Za-z0-9_]/.test(ch);
}
function isDigit(ch) {
    return ch >= "0" && ch <= "9";
}
function isHexDigit(ch) {
    return /[0-9a-fA-F]/.test(ch);
}
function scanNumber(state, startOffset, startLine, startCol, sign) {
    let lexeme = sign;
    const startIdx = state.offset;
    if (state.text.startsWith("0x", state.offset) || state.text.startsWith("0X", state.offset)) {
        lexeme += state.text.substr(state.offset, 2);
        advance(state, 2);
        while (isHexDigit(currentChar(state) ?? "")) {
            lexeme += currentChar(state);
            advance(state);
        }
    }
    else if (state.text.startsWith("0o", state.offset) || state.text.startsWith("0O", state.offset)) {
        lexeme += state.text.substr(state.offset, 2);
        advance(state, 2);
        while (/[0-7]/.test(currentChar(state) ?? "")) {
            lexeme += currentChar(state);
            advance(state);
        }
    }
    else if (state.text.startsWith("0b", state.offset) || state.text.startsWith("0B", state.offset)) {
        lexeme += state.text.substr(state.offset, 2);
        advance(state, 2);
        while (/[01]/.test(currentChar(state) ?? "")) {
            lexeme += currentChar(state);
            advance(state);
        }
    }
    else {
        while (isDigit(currentChar(state) ?? "")) {
            lexeme += currentChar(state);
            advance(state);
        }
    }
    if (state.offset === startIdx && sign) {
        // Only a sign with no digits.
        addToken(state, sign === "-" ? tokens_1.TokenKind.Minus : tokens_1.TokenKind.Plus, sign, startOffset, startLine, startCol);
        return;
    }
    addToken(state, tokens_1.TokenKind.Integer, lexeme, startOffset, startLine, startCol);
}
function scanIdentifier(state, startOffset, startLine, startCol) {
    let lexeme = "";
    while (isIdentifierPart(currentChar(state) ?? "")) {
        lexeme += currentChar(state);
        advance(state);
    }
    const lower = lexeme.toLowerCase();
    if (tokens_1.KEYWORDS.has(lower)) {
        if (lower === "true" || lower === "false") {
            addToken(state, tokens_1.TokenKind.Boolean, lexeme, startOffset, startLine, startCol);
        }
        else {
            addToken(state, tokens_1.TokenKind.Keyword, lexeme, startOffset, startLine, startCol);
        }
    }
    else {
        addToken(state, tokens_1.TokenKind.Identifier, lexeme, startOffset, startLine, startCol);
    }
}
function scanString(state, startOffset, startLine, startCol) {
    let lexeme = "";
    advance(state); // consume opening quote
    while (true) {
        const ch = currentChar(state);
        if (ch === undefined) {
            state.diagnostics.push({
                message: "Unterminated string literal",
                range: makeRange(state, startOffset, startLine, startCol),
            });
            break;
        }
        if (ch === '"') {
            advance(state);
            break;
        }
        if (ch === "\\") {
            const next = state.text[state.offset + 1];
            // Line continuation
            if (next === "\n" || (next === "\r" && state.text[state.offset + 2] === "\n")) {
                // skip backslash and newline(s)
                advance(state); // backslash
                if (currentChar(state) === "\r") {
                    advance(state);
                }
                advance(state); // newline
                continue;
            }
            lexeme += ch;
            advance(state);
            if (currentChar(state) !== undefined) {
                lexeme += currentChar(state);
                advance(state);
            }
            continue;
        }
        lexeme += ch;
        advance(state);
    }
    addToken(state, tokens_1.TokenKind.String, lexeme, startOffset, startLine, startCol);
}
function skipWhitespace(state) {
    while (true) {
        const ch = currentChar(state);
        if (ch === " " || ch === "\t" || ch === "\r") {
            advance(state);
        }
        else {
            break;
        }
    }
}
function scanClassification(state, startOffset, startLine, startCol) {
    let lexeme = "";
    while (true) {
        const ch = currentChar(state);
        if (ch === undefined)
            break;
        if (ch === "@" || ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === "," || ch === ":" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
            break;
        }
        if (/[A-Za-z0-9._/-]/.test(ch)) {
            lexeme += ch;
            advance(state);
            continue;
        }
        break;
    }
    addToken(state, tokens_1.TokenKind.Classification, lexeme, startOffset, startLine, startCol);
}
function lexText(text) {
    const state = {
        text,
        offset: 0,
        line: 0,
        column: 0,
        diagnostics: [],
        tokens: [],
        length: text.length,
        pendingClassification: false,
    };
    while (state.offset < state.length) {
        const startOffset = state.offset;
        const startLine = state.line;
        const startCol = state.column;
        const ch = currentChar(state);
        // Line continuation outside strings: backslash followed by optional spaces then newline
        if (ch === "\\") {
            let i = state.offset + 1;
            while (i < state.length && (state.text[i] === " " || state.text[i] === "\t")) {
                i++;
            }
            if (state.text[i] === "\r" && state.text[i + 1] === "\n") {
                i++; // allow CRLF
            }
            if (state.text[i] === "\n") {
                // consume through newline and continue
                while (state.offset <= i) {
                    advance(state);
                }
                continue;
            }
        }
        // Scope token
        if (ch === "$") {
            advance(state);
            addToken(state, tokens_1.TokenKind.Scope, "$", startOffset, startLine, startCol);
            continue;
        }
        // Newline
        if (ch === "\n") {
            advance(state);
            addToken(state, tokens_1.TokenKind.Newline, "\n", startOffset, startLine, startCol);
            continue;
        }
        // Whitespace
        if (ch === " " || ch === "\t" || ch === "\r") {
            skipWhitespace(state);
            continue;
        }
        // Comments
        if (ch === "/" && state.text[state.offset + 1] === "/") {
            while (currentChar(state) !== undefined && currentChar(state) !== "\n") {
                advance(state);
            }
            continue;
        }
        if (ch === "/" && state.text[state.offset + 1] === "*") {
            advance(state, 2);
            let closed = false;
            while (state.offset < state.length) {
                if (currentChar(state) === "*" && state.text[state.offset + 1] === "/") {
                    advance(state, 2);
                    closed = true;
                    break;
                }
                advance(state);
            }
            if (!closed) {
                state.diagnostics.push({
                    message: "Unterminated block comment",
                    range: makeRange(state, startOffset, startLine, startCol),
                });
            }
            continue;
        }
        // Classification immediately after job/sub/host/join
        if (state.pendingClassification && ch === "/") {
            scanClassification(state, startOffset, startLine, startCol);
            state.pendingClassification = false;
            // supplier suffix
            if (currentChar(state) === "@") {
                const atOffset = state.offset;
                const atLine = state.line;
                const atCol = state.column;
                advance(state);
                addToken(state, tokens_1.TokenKind.At, "@", atOffset, atLine, atCol);
                const supplierOffset = state.offset;
                const supplierLine = state.line;
                const supplierCol = state.column;
                let supplier = "";
                while (isIdentifierPart(currentChar(state) ?? "")) {
                    supplier += currentChar(state);
                    advance(state);
                }
                if (supplier.length > 0) {
                    addToken(state, tokens_1.TokenKind.Supplier, supplier, supplierOffset, supplierLine, supplierCol);
                }
                else {
                    state.diagnostics.push({
                        message: "Expected supplier identifier after @",
                        range: makeRange(state, atOffset, atLine, atCol),
                    });
                }
            }
            continue;
        }
        // Strings
        if (ch === '"') {
            scanString(state, startOffset, startLine, startCol);
            continue;
        }
        // Numbers with optional sign (must be directly adjacent)
        if ((ch === "+" || ch === "-") && isDigit(state.text[state.offset + 1] ?? "")) {
            const sign = ch;
            advance(state);
            scanNumber(state, startOffset, startLine, startCol, sign);
            continue;
        }
        if (isDigit(ch)) {
            scanNumber(state, startOffset, startLine, startCol, "");
            continue;
        }
        // Identifiers / keywords
        if (isIdentifierStart(ch)) {
            scanIdentifier(state, startOffset, startLine, startCol);
            const last = state.tokens[state.tokens.length - 1];
            if (last && last.kind === tokens_1.TokenKind.Keyword && ["job", "sub", "host", "join"].includes(last.lexeme)) {
                state.pendingClassification = true;
            }
            else {
                state.pendingClassification = false;
            }
            continue;
        }
        // Operators / punctuation
        const two = state.text.substr(state.offset, 2);
        switch (two) {
            case "->":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.Arrow, "->", startOffset, startLine, startCol);
                continue;
            case "==":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.EqualsEquals, "==", startOffset, startLine, startCol);
                continue;
            case "!=":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.BangEquals, "!=", startOffset, startLine, startCol);
                continue;
            case "<=":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.LessEquals, "<=", startOffset, startLine, startCol);
                continue;
            case ">=":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.GreaterEquals, ">=", startOffset, startLine, startCol);
                continue;
            case "&&":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.AndAnd, "&&", startOffset, startLine, startCol);
                continue;
            case "||":
                advance(state, 2);
                addToken(state, tokens_1.TokenKind.OrOr, "||", startOffset, startLine, startCol);
                continue;
        }
        switch (ch) {
            case ":":
                advance(state);
                addToken(state, tokens_1.TokenKind.Colon, ":", startOffset, startLine, startCol);
                continue;
            case "{":
                advance(state);
                addToken(state, tokens_1.TokenKind.LBrace, "{", startOffset, startLine, startCol);
                continue;
            case "}":
                advance(state);
                addToken(state, tokens_1.TokenKind.RBrace, "}", startOffset, startLine, startCol);
                continue;
            case "(":
                advance(state);
                addToken(state, tokens_1.TokenKind.LParen, "(", startOffset, startLine, startCol);
                continue;
            case ")":
                advance(state);
                addToken(state, tokens_1.TokenKind.RParen, ")", startOffset, startLine, startCol);
                continue;
            case ",":
                advance(state);
                addToken(state, tokens_1.TokenKind.Comma, ",", startOffset, startLine, startCol);
                continue;
            case "+":
                advance(state);
                addToken(state, tokens_1.TokenKind.Plus, "+", startOffset, startLine, startCol);
                continue;
            case "-":
                advance(state);
                addToken(state, tokens_1.TokenKind.Minus, "-", startOffset, startLine, startCol);
                continue;
            case "*":
                advance(state);
                addToken(state, tokens_1.TokenKind.Star, "*", startOffset, startLine, startCol);
                continue;
            case "/":
                advance(state);
                addToken(state, tokens_1.TokenKind.Slash, "/", startOffset, startLine, startCol);
                continue;
            case "%":
                advance(state);
                addToken(state, tokens_1.TokenKind.Percent, "%", startOffset, startLine, startCol);
                continue;
            case "<":
                advance(state);
                addToken(state, tokens_1.TokenKind.LessThan, "<", startOffset, startLine, startCol);
                continue;
            case ">":
                advance(state);
                addToken(state, tokens_1.TokenKind.GreaterThan, ">", startOffset, startLine, startCol);
                continue;
            case "!":
                advance(state);
                addToken(state, tokens_1.TokenKind.Bang, "!", startOffset, startLine, startCol);
                continue;
            case "@":
                advance(state);
                addToken(state, tokens_1.TokenKind.At, "@", startOffset, startLine, startCol);
                continue;
        }
        // Unknown
        advance(state);
        state.diagnostics.push({
            message: `Unrecognized character '${ch}'`,
            range: makeRange(state, startOffset, startLine, startCol),
        });
        addToken(state, tokens_1.TokenKind.Unknown, ch, startOffset, startLine, startCol);
        state.pendingClassification = false;
    }
    state.tokens.push({
        kind: tokens_1.TokenKind.EOF,
        lexeme: "",
        range: {
            start: { line: state.line, character: state.column },
            end: { line: state.line, character: state.column },
        },
    });
    return { tokens: state.tokens, diagnostics: state.diagnostics };
}
exports.lexText = lexText;
//# sourceMappingURL=lexer.js.map