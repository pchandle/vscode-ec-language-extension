import { Position, Range } from "vscode-languageserver";
import { KEYWORDS, SyntaxDiagnostic, Token, TokenKind } from "./tokens";

type State = {
  offset: number;
  line: number;
  column: number;
  text: string;
  diagnostics: SyntaxDiagnostic[];
  tokens: Token[];
  length: number;
  pendingClassification: boolean;
};

function currentChar(state: State): string | undefined {
  return state.text[state.offset];
}

function advance(state: State, count = 1): void {
  for (let i = 0; i < count; i++) {
    const ch = state.text[state.offset++];
    if (ch === "\n") {
      state.line += 1;
      state.column = 0;
    } else {
      state.column += 1;
    }
  }
}

function makeRange(state: State, startOffset: number, startLine: number, startCol: number): Range {
  return {
    start: { line: startLine, character: startCol },
    end: { line: state.line, character: state.column },
  };
}

function addToken(state: State, kind: TokenKind, lexeme: string, startOffset: number, startLine: number, startCol: number) {
  state.tokens.push({
    kind,
    lexeme,
    range: makeRange(state, startOffset, startLine, startCol),
  });
}

function isIdentifierStart(ch: string) {
  return /[A-Za-z_]/.test(ch);
}

function isIdentifierPart(ch: string) {
  return /[A-Za-z0-9_]/.test(ch);
}

function isDigit(ch: string) {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string) {
  return /[0-9a-fA-F]/.test(ch);
}

function scanNumber(state: State, startOffset: number, startLine: number, startCol: number, sign: string) {
  let lexeme = sign;
  const startIdx = state.offset;
  if (state.text.startsWith("0x", state.offset) || state.text.startsWith("0X", state.offset)) {
    lexeme += state.text.substr(state.offset, 2);
    advance(state, 2);
    while (isHexDigit(currentChar(state) ?? "")) {
      lexeme += currentChar(state)!;
      advance(state);
    }
  } else if (state.text.startsWith("0o", state.offset) || state.text.startsWith("0O", state.offset)) {
    lexeme += state.text.substr(state.offset, 2);
    advance(state, 2);
    while (/[0-7]/.test(currentChar(state) ?? "")) {
      lexeme += currentChar(state)!;
      advance(state);
    }
  } else if (state.text.startsWith("0b", state.offset) || state.text.startsWith("0B", state.offset)) {
    lexeme += state.text.substr(state.offset, 2);
    advance(state, 2);
    while (/[01]/.test(currentChar(state) ?? "")) {
      lexeme += currentChar(state)!;
      advance(state);
    }
  } else {
    while (isDigit(currentChar(state) ?? "")) {
      lexeme += currentChar(state)!;
      advance(state);
    }
  }

  if (state.offset === startIdx && sign) {
    // Only a sign with no digits.
    addToken(state, sign === "-" ? TokenKind.Minus : TokenKind.Plus, sign, startOffset, startLine, startCol);
    return;
  }

  addToken(state, TokenKind.Integer, lexeme, startOffset, startLine, startCol);
}

function scanIdentifier(state: State, startOffset: number, startLine: number, startCol: number) {
  let lexeme = "";
  while (isIdentifierPart(currentChar(state) ?? "")) {
    lexeme += currentChar(state)!;
    advance(state);
  }
  const lower = lexeme.toLowerCase();
  if (KEYWORDS.has(lower as any)) {
    if (lower === "true" || lower === "false") {
      addToken(state, TokenKind.Boolean, lexeme, startOffset, startLine, startCol);
    } else {
      addToken(state, TokenKind.Keyword, lexeme, startOffset, startLine, startCol);
    }
  } else {
    addToken(state, TokenKind.Identifier, lexeme, startOffset, startLine, startCol);
  }
}

function scanString(state: State, startOffset: number, startLine: number, startCol: number) {
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
        lexeme += currentChar(state)!;
        advance(state);
      }
      continue;
    }
    lexeme += ch;
    advance(state);
  }
  addToken(state, TokenKind.String, lexeme, startOffset, startLine, startCol);
}

function skipWhitespace(state: State) {
  while (true) {
    const ch = currentChar(state);
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance(state);
    } else {
      break;
    }
  }
}

function scanClassification(state: State, startOffset: number, startLine: number, startCol: number) {
  let lexeme = "";
  while (true) {
    const ch = currentChar(state);
    if (ch === undefined) break;
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
  addToken(state, TokenKind.Classification, lexeme, startOffset, startLine, startCol);
}

export function lexText(text: string): { tokens: Token[]; diagnostics: SyntaxDiagnostic[] } {
  const state: State = {
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
    const ch = currentChar(state)!;

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
      addToken(state, TokenKind.Scope, "$", startOffset, startLine, startCol);
      continue;
    }

    // Newline
    if (ch === "\n") {
      advance(state);
      addToken(state, TokenKind.Newline, "\n", startOffset, startLine, startCol);
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
        addToken(state, TokenKind.At, "@", atOffset, atLine, atCol);
        const supplierOffset = state.offset;
        const supplierLine = state.line;
        const supplierCol = state.column;
        let supplier = "";
        while (isIdentifierPart(currentChar(state) ?? "")) {
          supplier += currentChar(state)!;
          advance(state);
        }
        if (supplier.length > 0) {
          addToken(state, TokenKind.Supplier, supplier, supplierOffset, supplierLine, supplierCol);
        } else {
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
      if (last && last.kind === TokenKind.Keyword && ["job", "sub", "host", "join"].includes(last.lexeme)) {
        state.pendingClassification = true;
      } else {
        state.pendingClassification = false;
      }
      continue;
    }

    // Operators / punctuation
    const two = state.text.substr(state.offset, 2);
    switch (two) {
      case "->":
        advance(state, 2);
        addToken(state, TokenKind.Arrow, "->", startOffset, startLine, startCol);
        continue;
      case "==":
        advance(state, 2);
        addToken(state, TokenKind.EqualsEquals, "==", startOffset, startLine, startCol);
        continue;
      case "!=":
        advance(state, 2);
        addToken(state, TokenKind.BangEquals, "!=", startOffset, startLine, startCol);
        continue;
      case "<=":
        advance(state, 2);
        addToken(state, TokenKind.LessEquals, "<=", startOffset, startLine, startCol);
        continue;
      case ">=":
        advance(state, 2);
        addToken(state, TokenKind.GreaterEquals, ">=", startOffset, startLine, startCol);
        continue;
      case "&&":
        advance(state, 2);
        addToken(state, TokenKind.AndAnd, "&&", startOffset, startLine, startCol);
        continue;
      case "||":
        advance(state, 2);
        addToken(state, TokenKind.OrOr, "||", startOffset, startLine, startCol);
        continue;
    }

    switch (ch) {
      case ":":
        advance(state);
        addToken(state, TokenKind.Colon, ":", startOffset, startLine, startCol);
        continue;
      case "{":
        advance(state);
        addToken(state, TokenKind.LBrace, "{", startOffset, startLine, startCol);
        continue;
      case "}":
        advance(state);
        addToken(state, TokenKind.RBrace, "}", startOffset, startLine, startCol);
        continue;
      case "(":
        advance(state);
        addToken(state, TokenKind.LParen, "(", startOffset, startLine, startCol);
        continue;
      case ")":
        advance(state);
        addToken(state, TokenKind.RParen, ")", startOffset, startLine, startCol);
        continue;
      case ",":
        advance(state);
        addToken(state, TokenKind.Comma, ",", startOffset, startLine, startCol);
        continue;
      case "+":
        advance(state);
        addToken(state, TokenKind.Plus, "+", startOffset, startLine, startCol);
        continue;
      case "-":
        advance(state);
        addToken(state, TokenKind.Minus, "-", startOffset, startLine, startCol);
        continue;
      case "*":
        advance(state);
        addToken(state, TokenKind.Star, "*", startOffset, startLine, startCol);
        continue;
      case "/":
        advance(state);
        addToken(state, TokenKind.Slash, "/", startOffset, startLine, startCol);
        continue;
      case "%":
        advance(state);
        addToken(state, TokenKind.Percent, "%", startOffset, startLine, startCol);
        continue;
      case "<":
        advance(state);
        addToken(state, TokenKind.LessThan, "<", startOffset, startLine, startCol);
        continue;
      case ">":
        advance(state);
        addToken(state, TokenKind.GreaterThan, ">", startOffset, startLine, startCol);
        continue;
      case "!":
        advance(state);
        addToken(state, TokenKind.Bang, "!", startOffset, startLine, startCol);
        continue;
      case "@":
        advance(state);
        addToken(state, TokenKind.At, "@", startOffset, startLine, startCol);
        continue;
    }

    // Unknown
    advance(state);
    state.diagnostics.push({
      message: `Unrecognized character '${ch}'`,
      range: makeRange(state, startOffset, startLine, startCol),
    });
    addToken(state, TokenKind.Unknown, ch, startOffset, startLine, startCol);
    state.pendingClassification = false;
  }

  state.tokens.push({
    kind: TokenKind.EOF,
    lexeme: "",
    range: {
      start: { line: state.line, character: state.column },
      end: { line: state.line, character: state.column },
    },
  });

  return { tokens: state.tokens, diagnostics: state.diagnostics };
}
