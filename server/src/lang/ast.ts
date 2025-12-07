import { Range } from "vscode-languageserver";
import { Token, TokenKind } from "./tokens";

export enum NodeKind {
  Program = "Program",
  Statement = "Statement",
  Job = "Job",
  Def = "Def",
  If = "If",
  Block = "Block",
  Binary = "Binary",
  Unary = "Unary",
  Literal = "Literal",
  Identifier = "Identifier",
  Classification = "Classification",
  Qualified = "Qualified",
  Call = "Call",
  Scope = "Scope",
}

export interface BaseNode {
  kind: NodeKind;
  range: Range;
}

export interface ProgramNode extends BaseNode {
  kind: NodeKind.Program;
  statements: Statement[];
}

export interface StatementNode extends BaseNode {
  kind: NodeKind.Statement;
  expression: ExpressionNode | null;
  targets: Token[];
  keyword?: Token;
  callArgs?: ExpressionNode[];
  obligationOrder?: Array<Token | BlockNode>;
  block?: BlockNode;
  classification?: Token;
}

export interface JobNode extends BaseNode {
  kind: NodeKind.Job;
  classification?: Token;
  params: Token[];
  targets: Token[];
  body: BlockNode;
}

export interface DefNode extends BaseNode {
  kind: NodeKind.Def;
  name: Token;
  params: Token[];
  targets: Token[];
  body: BlockNode;
}

export interface IfNode extends BaseNode {
  kind: NodeKind.If;
  condition: ExpressionNode | null;
  thenBlock: BlockNode;
  elseBlock?: BlockNode;
  targets: Token[];
}

export interface BlockNode extends BaseNode {
  kind: NodeKind.Block;
  statements: Statement[];
}

export type ScopeRefNode = BaseNode & { kind: NodeKind.Scope; token: Token };
export type QualifiedNode = BaseNode & { kind: NodeKind.Qualified; base: ExpressionNode; supplier: Token };
export type CallNode = BaseNode & { kind: NodeKind.Call; callee: ExpressionNode; args: ExpressionNode[] };
export type ExpressionNode =
  | BinaryNode
  | UnaryNode
  | LiteralNode
  | IdentifierNode
  | ClassificationNode
  | ScopeRefNode
  | QualifiedNode
  | CallNode;

export interface BinaryNode extends BaseNode {
  kind: NodeKind.Binary;
  operator: Token;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryNode extends BaseNode {
  kind: NodeKind.Unary;
  operator: Token;
  operand: ExpressionNode;
}

export interface LiteralNode extends BaseNode {
  kind: NodeKind.Literal;
  token: Token;
}

export interface IdentifierNode extends BaseNode {
  kind: NodeKind.Identifier;
  token: Token;
}

export interface ClassificationNode extends BaseNode {
  kind: NodeKind.Classification;
  token: Token;
}

export type Statement = StatementNode | JobNode | DefNode;

export type AnyNode = ProgramNode | Statement | IfNode | BlockNode | ExpressionNode | ScopeRefNode;

export function rangeFromTokens(start: Token, end: Token): Range {
  return { start: start.range.start, end: end.range.end };
}

export function rangeFromNode(start: BaseNode, end: BaseNode): Range {
  return { start: start.range.start, end: end.range.end };
}
