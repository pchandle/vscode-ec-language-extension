import { SyntaxDiagnostic, Token, TokenKind } from "./tokens";
import { BlockNode, DefNode, ExpressionNode, IdentifierNode, IfNode, JobNode, NodeKind, ProgramNode, QualifiedNode, ScopeRefNode, Statement } from "./ast";

type BindingKind = "param" | "target" | "def" | "builtin";
type BindingOrigin = "header" | "body" | "builtin";

interface Binding {
  name: Token;
  kind: BindingKind;
  origin: BindingOrigin;
}

interface Scope {
  parent?: Scope;
  bindings: Map<string, Binding>;
}

const BUILTIN_SCOPE_TOKEN: Token = {
  kind: TokenKind.Scope,
  lexeme: "$",
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
};
const BUILTIN_FUNCTION_TOKENS: Token[] = [
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
].map((lexeme) => ({
  kind: TokenKind.Keyword,
  lexeme,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
}));

function makeScope(parent?: Scope): Scope {
  const scope: Scope = { parent, bindings: new Map<string, Binding>() };
  scope.bindings.set("$", { name: BUILTIN_SCOPE_TOKEN, kind: "builtin", origin: "builtin" });
  for (const token of BUILTIN_FUNCTION_TOKENS) {
    scope.bindings.set(token.lexeme, { name: token, kind: "builtin", origin: "builtin" });
  }
  return scope;
}

function declare(
  scope: Scope,
  token: Token,
  kind: BindingKind,
  diagnostics: SyntaxDiagnostic[],
  origin: BindingOrigin = "body"
) {
  const name = token.lexeme;
  if (!name || name === "_") {
    return;
  }
  if (name === "$") {
    diagnostics.push({ message: "Cannot redeclare reserved name '$'", range: token.range });
    return;
  }
  const existing = scope.bindings.get(name);
  if (existing) {
    if (existing.origin === "header" && existing.kind === "target" && kind === "target" && origin === "body") {
      // Assigning to a header-declared target; allowed.
      return;
    }
    diagnostics.push({ message: `Duplicate declaration of '${name}'`, range: token.range });
    return;
  }
  scope.bindings.set(name, { name: token, kind, origin });
}

const RESERVED_KEYWORDS = new Set(["sub", "job", "host", "join", "deliver", "def", "if", "then", "else", "end"]);

function resolveToken(scope: Scope, token: Token): Binding | undefined {
  if (token.lexeme === "_" || token.lexeme === "$") {
    // '_' is intentionally ignored; '$' is a builtin injected per scope.
    return scope.bindings.get("$");
  }
  if (token.kind === TokenKind.Keyword && RESERVED_KEYWORDS.has(token.lexeme.toLowerCase())) {
    return scope.bindings.get("$"); // treat reserved keywords as built-ins; no diagnostic
  }
  let current: Scope | undefined = scope;
  while (current) {
    const binding = current.bindings.get(token.lexeme);
    if (binding) {
      return binding;
    }
    current = current.parent;
  }
  return undefined;
}

function resolveExpression(expr: ExpressionNode | null, scope: Scope, diagnostics: SyntaxDiagnostic[]) {
  if (!expr) return;
  switch (expr.kind) {
    case NodeKind.Identifier: {
      const id = expr as IdentifierNode;
      if (!resolveToken(scope, id.token)) {
        diagnostics.push({ message: `Undefined name '${id.token.lexeme}'`, range: id.token.range });
      }
      break;
    }
    case NodeKind.Scope: {
      const scopeRef = expr as ScopeRefNode;
      if (!resolveToken(scope, scopeRef.token)) {
        diagnostics.push({ message: "Undefined scope reference '$'", range: scopeRef.range });
      }
      break;
    }
    case NodeKind.Classification:
    case NodeKind.Literal:
      break;
    case NodeKind.Unary:
      resolveExpression(expr.operand, scope, diagnostics);
      break;
    case NodeKind.Binary:
      resolveExpression(expr.left, scope, diagnostics);
      resolveExpression(expr.right, scope, diagnostics);
      break;
    case NodeKind.Qualified: {
      const qualified = expr as QualifiedNode;
      resolveExpression(qualified.base, scope, diagnostics);
      break;
    }
    case NodeKind.Call:
      resolveExpression(expr.callee, scope, diagnostics);
      for (const arg of expr.args) {
        resolveExpression(arg, scope, diagnostics);
      }
      break;
  }
}

function resolveBlock(block: BlockNode, scope: Scope, diagnostics: SyntaxDiagnostic[]) {
  predeclareBlock(block, scope, diagnostics);
  for (const stmt of block.statements) {
    resolveStatement(stmt, scope, diagnostics);
  }
}

function resolveIf(ifNode: IfNode, scope: Scope, diagnostics: SyntaxDiagnostic[]) {
  resolveExpression(ifNode.condition, scope, diagnostics);
  const thenScope = makeScope(scope);
  resolveBlock(ifNode.thenBlock, thenScope, diagnostics);
  if (ifNode.elseBlock) {
    const elseScope = makeScope(scope);
    resolveBlock(ifNode.elseBlock, elseScope, diagnostics);
  }
}

function resolveStatement(stmt: Statement, scope: Scope, diagnostics: SyntaxDiagnostic[]) {
  switch (stmt.kind) {
    case NodeKind.Job: {
      const job = stmt as JobNode;
      const jobScope = makeScope(scope);
      for (const param of job.params) {
        declare(jobScope, param, "param", diagnostics, "header");
      }
      for (const target of job.targets) {
        declare(jobScope, target, "target", diagnostics, "header");
      }
      resolveBlock(job.body, jobScope, diagnostics);
      return;
    }
    case NodeKind.Def: {
      const def = stmt as DefNode;
      const defScope = makeScope(scope);
      for (const param of def.params) {
        declare(defScope, param, "param", diagnostics, "header");
      }
      for (const target of def.targets) {
        declare(defScope, target, "target", diagnostics, "header");
      }
      resolveBlock(def.body, defScope, diagnostics);
      return;
    }
    case NodeKind.Statement: {
      resolveExpression(stmt.expression, scope, diagnostics);
      if (stmt.block) {
        // Braced blocks do not create new scopes; they leak to the current scope.
        resolveBlock(stmt.block, scope, diagnostics);
      }
      return;
    }
    default:
      return;
  }
}

export function resolveProgram(program: ProgramNode): { diagnostics: SyntaxDiagnostic[] } {
  const diagnostics: SyntaxDiagnostic[] = [];
  const rootScope = makeScope();
  predeclareBlock(program as unknown as BlockNode, rootScope, diagnostics);
  for (const stmt of program.statements) {
    resolveStatement(stmt, rootScope, diagnostics);
  }
  return { diagnostics };
}

function predeclareBlock(block: BlockNode, scope: Scope, diagnostics: SyntaxDiagnostic[]) {
  for (const stmt of block.statements) {
    switch (stmt.kind) {
      case NodeKind.Def: {
        const def = stmt as DefNode;
        declare(scope, def.name, "def", diagnostics, "header");
        continue;
      }
      case NodeKind.Statement: {
        for (const target of stmt.targets) {
          declare(scope, target, "target", diagnostics, "body");
        }
        continue;
      }
      default:
        continue;
    }
  }
}
