import { Position, Range } from "vscode-languageserver";

export enum TokenKind {
  EOF = "EOF",
  Identifier = "Identifier",
  Keyword = "Keyword",
  Boolean = "Boolean",
  Integer = "Integer",
  String = "String",
  Classification = "Classification",
  Scope = "Scope",
  Supplier = "Supplier",
  Arrow = "Arrow",
  Colon = "Colon",
  LBrace = "LBrace",
  RBrace = "RBrace",
  LParen = "LParen",
  RParen = "RParen",
  Comma = "Comma",
  EqualsEquals = "EqualsEquals",
  BangEquals = "BangEquals",
  LessEquals = "LessEquals",
  GreaterEquals = "GreaterEquals",
  LessThan = "LessThan",
  GreaterThan = "GreaterThan",
  AndAnd = "AndAnd",
  OrOr = "OrOr",
  Plus = "Plus",
  Minus = "Minus",
  Star = "Star",
  Slash = "Slash",
  Percent = "Percent",
  Bang = "Bang",
  At = "At",
  Newline = "Newline",
  Unknown = "Unknown",
}

export interface Token {
  kind: TokenKind;
  lexeme: string;
  range: Range;
}

export interface SyntaxDiagnostic {
  message: string;
  range: Range;
}

export type Keyword =
  | "defaults"
  | "asset"
  | "job"
  | "sub"
  | "host"
  | "join"
  | "deliver"
  | "def"
  | "if"
  | "then"
  | "else"
  | "end"
  | "true"
  | "false"
  | "max"
  | "min"
  | "concat"
  | "len"
  | "maxlen"
  | "trunc"
  | "replace"
  | "escape"
  | "int2str"
  | "pack"
  | "pad";

export const KEYWORDS = new Set<Keyword>([
  "defaults",
  "asset",
  "job",
  "sub",
  "host",
  "join",
  "deliver",
  "def",
  "if",
  "then",
  "else",
  "end",
  "true",
  "false",
  "max",
  "min",
  "concat",
  "len",
  "maxlen",
  "trunc",
  "replace",
  "escape",
  "int2str",
  "pack",
  "pad",
]);

export function makeRange(
  startOffset: number,
  endOffset: number,
  start: Position,
  end: Position
): Range {
  return {
    start,
    end,
  };
}
