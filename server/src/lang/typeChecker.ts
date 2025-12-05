import { Range } from "vscode-languageserver";
import { BlockNode, DefNode, ExpressionNode, IfNode, JobNode, NodeKind, ProgramNode, QualifiedNode, ScopeRefNode, Statement } from "./ast";
import { SyntaxDiagnostic, Token, TokenKind } from "./tokens";

export enum TypeKind {
  Unknown = "Unknown",
  Integer = "Integer",
  String = "String",
  Boolean = "Boolean",
  Classification = "Classification",
  Scope = "Scope",
  Function = "Function",
}

export type Type =
  | { kind: TypeKind.Unknown }
  | { kind: TypeKind.Integer }
  | { kind: TypeKind.String }
  | { kind: TypeKind.Boolean }
  | { kind: TypeKind.Classification; classification?: string }
  | { kind: TypeKind.Scope }
  | FunctionType;

export interface FunctionType {
  kind: TypeKind.Function;
  params: Type[];
  returns: Type[];
  variadic?: Type;
  enforceArity?: boolean;
}

interface TypeBinding {
  type: Type;
}

interface TypeScope {
  parent?: TypeScope;
  bindings: Map<string, TypeBinding>;
}

type TypeResult = Type[];

const UNKNOWN: Type = { kind: TypeKind.Unknown };
const INTEGER: Type = { kind: TypeKind.Integer };
const STRING: Type = { kind: TypeKind.String };
const BOOLEAN: Type = { kind: TypeKind.Boolean };
const SCOPE_TYPE: Type = { kind: TypeKind.Scope };

type BuiltinSignature = { params: Type[]; returns: Type[]; variadic?: Type; enforceArity?: boolean };

const BUILTIN_FUNCTIONS: Record<string, BuiltinSignature> = {
  max: { params: [INTEGER, INTEGER], returns: [INTEGER], variadic: INTEGER },
  min: { params: [INTEGER, INTEGER], returns: [INTEGER], variadic: INTEGER },
  concat: { params: [STRING, STRING], returns: [STRING], variadic: STRING },
  len: { params: [STRING], returns: [INTEGER] },
  trunc: { params: [STRING, INTEGER], returns: [STRING] },
  replace: { params: [STRING, STRING, STRING], returns: [STRING] },
  int2str: { params: [INTEGER], returns: [STRING] },
  pack: { params: [STRING, INTEGER], returns: [STRING] },
  pad: { params: [STRING, STRING, INTEGER], returns: [STRING] },
  escape: { params: [STRING], returns: [STRING] },
  maxlen: { params: [STRING], returns: [INTEGER] },
};

export function typeCheckProgram(program: ProgramNode): { diagnostics: SyntaxDiagnostic[] } {
  const diagnostics: SyntaxDiagnostic[] = [];
  const scope = makeScope();
  for (const stmt of program.statements) {
    typeCheckStatement(stmt, scope, diagnostics);
  }
  return { diagnostics };
}

function makeScope(parent?: TypeScope, scopeType?: Type): TypeScope {
  const scope: TypeScope = { parent, bindings: new Map() };
  scope.bindings.set("$", { type: scopeType ?? SCOPE_TYPE });
  return scope;
}

function lookup(scope: TypeScope, name: string): TypeBinding | undefined {
  let current: TypeScope | undefined = scope;
  while (current) {
    const binding = current.bindings.get(name);
    if (binding) {
      return binding;
    }
    current = current.parent;
  }
  return undefined;
}

function declare(scope: TypeScope, token: Token, type: Type): TypeBinding {
  const binding = scope.bindings.get(token.lexeme);
  if (binding) {
    binding.type = mergeTypes(binding.type, type);
    return binding;
  }
  const newBinding = { type };
  scope.bindings.set(token.lexeme, newBinding);
  return newBinding;
}

function typeFromLiteral(token: Token): Type {
  switch (token.kind) {
    case TokenKind.Integer:
      return INTEGER;
    case TokenKind.String:
      return STRING;
    case TokenKind.Boolean:
      return BOOLEAN;
    default:
      return UNKNOWN;
  }
}

function mergeTypes(existing: Type, incoming: Type): Type {
  if (existing.kind === TypeKind.Unknown) return incoming;
  if (incoming.kind === TypeKind.Unknown) return existing;
  if (existing.kind === TypeKind.Classification && incoming.kind === TypeKind.Classification) {
    if (!existing.classification) return incoming;
    if (!incoming.classification) return existing;
    return existing.classification === incoming.classification ? existing : incoming;
  }
  return existing.kind === incoming.kind ? existing : existing;
}

function isUnknown(type: Type): boolean {
  return type.kind === TypeKind.Unknown;
}

function typeToString(type: Type): string {
  switch (type.kind) {
    case TypeKind.Integer:
      return "INTEGER";
    case TypeKind.String:
      return "STRING";
    case TypeKind.Boolean:
      return "BOOLEAN";
    case TypeKind.Classification:
      return type.classification ? `CLASSIFICATION(${type.classification})` : "CLASSIFICATION";
    case TypeKind.Scope:
      return "SCOPE";
    case TypeKind.Function:
      return "FUNCTION";
    case TypeKind.Unknown:
    default:
      return "UNKNOWN";
  }
}

function addTypeError(diagnostics: SyntaxDiagnostic[], range: Range, message: string) {
  diagnostics.push({ message, range });
}

function ensureBoolean(type: Type, range: Range, diagnostics: SyntaxDiagnostic[]) {
  if (isUnknown(type)) return;
  if (type.kind !== TypeKind.Boolean) {
    addTypeError(diagnostics, range, `Expected BOOLEAN, got ${typeToString(type)}`);
  }
}

function ensureInteger(type: Type, range: Range, diagnostics: SyntaxDiagnostic[]) {
  if (isUnknown(type)) return;
  if (type.kind !== TypeKind.Integer) {
    addTypeError(diagnostics, range, `Expected INTEGER, got ${typeToString(type)}`);
  }
}

function ensureString(type: Type, range: Range, diagnostics: SyntaxDiagnostic[]) {
  if (isUnknown(type)) return;
  if (type.kind !== TypeKind.String) {
    addTypeError(diagnostics, range, `Expected STRING, got ${typeToString(type)}`);
  }
}

function ensureAssignable(expected: Type, actual: Type, range: Range, diagnostics: SyntaxDiagnostic[]) {
  if (isUnknown(expected) || isUnknown(actual)) return;
  if (expected.kind === TypeKind.Classification && actual.kind === TypeKind.Classification) {
    if (expected.classification && actual.classification && expected.classification !== actual.classification) {
      addTypeError(diagnostics, range, `Type mismatch: expected ${typeToString(expected)}, got ${typeToString(actual)}`);
    }
    return;
  }
  if (expected.kind !== actual.kind) {
    addTypeError(diagnostics, range, `Type mismatch: expected ${typeToString(expected)}, got ${typeToString(actual)}`);
  }
}

function typeCheckStatement(stmt: Statement, scope: TypeScope, diagnostics: SyntaxDiagnostic[]) {
  switch (stmt.kind) {
    case NodeKind.Job: {
      const job = stmt as JobNode;
      const jobScope = makeScope(scope);
      for (const param of job.params) {
        declare(jobScope, param, UNKNOWN);
      }
      for (const target of job.targets) {
        declare(jobScope, target, UNKNOWN);
      }
      typeCheckBlock(job.body, jobScope, diagnostics);
      return;
    }
    case NodeKind.Def: {
      const def = stmt as DefNode;
      const placeholder: FunctionType = {
        kind: TypeKind.Function,
        params: def.params.map(() => UNKNOWN),
        returns: def.targets.map(() => UNKNOWN),
      };
      declare(scope, def.name, placeholder);

      const defScope = makeScope(scope);
      for (const param of def.params) {
        declare(defScope, param, UNKNOWN);
      }
      for (const target of def.targets) {
        declare(defScope, target, UNKNOWN);
      }
      typeCheckBlock(def.body, defScope, diagnostics);

      placeholder.params = def.params.map((p) => lookup(defScope, p.lexeme)?.type ?? UNKNOWN);
      placeholder.returns = def.targets.map((t) => lookup(defScope, t.lexeme)?.type ?? UNKNOWN);
      return;
    }
    case NodeKind.Statement: {
      const exprTypes = typeCheckExpression(stmt.expression as ExpressionNode | null, scope, diagnostics);
      const targetCount = stmt.targets.length;
      const resultCount = exprTypes.length;

      let assignmentTypes: Type[] = [];
      if (targetCount > 0) {
        if (resultCount === targetCount) {
          assignmentTypes = exprTypes;
        } else if (resultCount === 1 && targetCount > 1) {
          assignmentTypes = new Array(targetCount).fill(exprTypes[0]);
        } else if (resultCount === 0) {
          assignmentTypes = new Array(targetCount).fill(UNKNOWN);
        } else {
          addTypeError(
            diagnostics,
            stmt.range,
            `Target count (${targetCount}) does not match expression results (${resultCount})`
          );
          assignmentTypes = new Array(targetCount).fill(UNKNOWN);
        }
      }

      for (let i = 0; i < stmt.targets.length; i++) {
        const target = stmt.targets[i];
        const incomingType = assignmentTypes[i] ?? UNKNOWN;
        declare(scope, target, incomingType);
      }

      if (stmt.block) {
        const scopeBinding = scope.bindings.get("$");
        const originalScopeType = scopeBinding?.type ?? UNKNOWN;
        const incoming = exprTypes[0] ?? originalScopeType;
        if (scopeBinding) {
          scopeBinding.type = incoming;
        }
        typeCheckBlock(stmt.block, scope, diagnostics);
        if (scopeBinding) {
          scopeBinding.type = originalScopeType;
        }
      }
      return;
    }
    default:
      return;
  }
}

function typeCheckBlock(block: BlockNode, scope: TypeScope, diagnostics: SyntaxDiagnostic[]): Map<string, Type> {
  for (const stmt of block.statements) {
    typeCheckStatement(stmt, scope, diagnostics);
  }
  const declared = new Map<string, Type>();
  for (const [name, binding] of scope.bindings.entries()) {
    if (name === "$") continue;
    declared.set(name, binding.type);
  }
  return declared;
}

function typeCheckExpression(expr: ExpressionNode | IfNode | null, scope: TypeScope, diagnostics: SyntaxDiagnostic[]): TypeResult {
  if (!expr) return [];
  switch (expr.kind) {
    case NodeKind.Identifier: {
      const binding = lookup(scope, (expr as any).token.lexeme);
      return [binding?.type ?? UNKNOWN];
    }
    case NodeKind.Scope: {
      const scopeRef = expr as ScopeRefNode;
      const binding = lookup(scope, scopeRef.token.lexeme);
      return [binding?.type ?? SCOPE_TYPE];
    }
    case NodeKind.Classification:
      return [{ kind: TypeKind.Classification, classification: (expr as any).token.lexeme }];
    case NodeKind.Literal:
      return [typeFromLiteral((expr as any).token)];
    case NodeKind.Unary: {
      const operandTypes = typeCheckExpression((expr as any).operand, scope, diagnostics);
      const operandType = operandTypes[0] ?? UNKNOWN;
      const op = (expr as any).operator;
      if (op.kind === TokenKind.Bang) {
        ensureBoolean(operandType, op.range, diagnostics);
        return [BOOLEAN];
      }
      if (op.kind === TokenKind.Plus || op.kind === TokenKind.Minus) {
        ensureInteger(operandType, op.range, diagnostics);
        return [INTEGER];
      }
      return [UNKNOWN];
    }
    case NodeKind.Binary: {
      const binary = expr as any;
      const left = typeCheckExpression(binary.left, scope, diagnostics)[0] ?? UNKNOWN;
      const right = typeCheckExpression(binary.right, scope, diagnostics)[0] ?? UNKNOWN;
      const op = binary.operator.kind;
      switch (op) {
        case TokenKind.Plus: {
          if (!isUnknown(left) && !isUnknown(right)) {
            if (left.kind === TypeKind.Integer && right.kind === TypeKind.Integer) return [INTEGER];
            if (left.kind === TypeKind.String && right.kind === TypeKind.String) return [STRING];
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Operator '+' requires INTEGER+INTEGER or STRING+STRING, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          return [UNKNOWN];
        }
        case TokenKind.Minus:
          ensureInteger(left, binary.operator.range, diagnostics);
          ensureInteger(right, binary.operator.range, diagnostics);
          return [INTEGER];
        case TokenKind.Star: {
          if (!isUnknown(left) && !isUnknown(right)) {
            const leftIsInt = left.kind === TypeKind.Integer;
            const rightIsInt = right.kind === TypeKind.Integer;
            const leftIsString = left.kind === TypeKind.String;
            const rightIsString = right.kind === TypeKind.String;
            if (leftIsInt && rightIsInt) return [INTEGER];
            if ((leftIsInt && rightIsString) || (leftIsString && rightIsInt)) return [STRING];
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Operator '*' requires INTEGER*INTEGER or STRING*INTEGER, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          return [UNKNOWN];
        }
        case TokenKind.Slash:
        case TokenKind.Percent:
          ensureInteger(left, binary.operator.range, diagnostics);
          ensureInteger(right, binary.operator.range, diagnostics);
          return [INTEGER];
        case TokenKind.EqualsEquals:
        case TokenKind.BangEquals: {
          if (!isUnknown(left) && !isUnknown(right) && left.kind !== right.kind) {
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Comparison requires matching types, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          return [BOOLEAN];
        }
        case TokenKind.GreaterThan:
        case TokenKind.GreaterEquals:
        case TokenKind.LessThan:
        case TokenKind.LessEquals: {
          const bothInts = left.kind === TypeKind.Integer && right.kind === TypeKind.Integer;
          if (!isUnknown(left) && !isUnknown(right) && !bothInts) {
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Relational operators require INTEGER operands, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          return [BOOLEAN];
        }
        case TokenKind.AndAnd:
        case TokenKind.OrOr:
          ensureBoolean(left, binary.operator.range, diagnostics);
          ensureBoolean(right, binary.operator.range, diagnostics);
          return [BOOLEAN];
        default:
          return [UNKNOWN];
      }
    }
    case NodeKind.Qualified: {
      const qualified = expr as QualifiedNode;
      return typeCheckExpression(qualified.base, scope, diagnostics);
    }
    case NodeKind.Call: {
      const call = expr as any;
      const calleeId = extractIdentifier(call.callee);
      const builtin = calleeId ? BUILTIN_FUNCTIONS[calleeId.toLowerCase()] : undefined;
      const calleeType = builtin ? builtinToFunctionType(builtin) : typeCheckExpression(call.callee, scope, diagnostics)[0] ?? UNKNOWN;

      const argTypes = call.args.map((arg: ExpressionNode) => typeCheckExpression(arg, scope, diagnostics)[0] ?? UNKNOWN);
      const returns = applyFunctionType(calleeType, argTypes, call.range, diagnostics, builtin?.enforceArity ?? true);
      return returns;
    }
    case NodeKind.If: {
      const ifNode = expr as IfNode;
      const conditionTypes = typeCheckExpression(ifNode.condition, scope, diagnostics);
      ensureBoolean(conditionTypes[0] ?? UNKNOWN, ifNode.range, diagnostics);

      const thenScope = makeScope(scope, lookup(scope, "$")?.type);
      const elseScope = makeScope(scope, lookup(scope, "$")?.type);
      const thenBindings = typeCheckBlock(ifNode.thenBlock, thenScope, diagnostics);
      const elseBindings = ifNode.elseBlock ? typeCheckBlock(ifNode.elseBlock, elseScope, diagnostics) : new Map<string, Type>();
      for (const [name, thenType] of thenBindings.entries()) {
        if (elseBindings.has(name)) {
          const elseType = elseBindings.get(name)!;
          if (!isUnknown(thenType) && !isUnknown(elseType) && thenType.kind !== elseType.kind) {
            addTypeError(
              diagnostics,
              ifNode.range,
              `Branches assign different types to '${name}': ${typeToString(thenType)} vs ${typeToString(elseType)}`
            );
          }
        }
      }

      const outputCount = ifNode.targets.length;
      return new Array(outputCount).fill(UNKNOWN);
    }
    default:
      return [UNKNOWN];
  }
}

function extractIdentifier(expr: ExpressionNode): string | null {
  if (expr.kind === NodeKind.Identifier) {
    return (expr as any).token.lexeme;
  }
  return null;
}

function builtinToFunctionType(sig: BuiltinSignature): FunctionType {
  return {
    kind: TypeKind.Function,
    params: sig.params,
    returns: sig.returns,
    variadic: sig.variadic,
    enforceArity: sig.enforceArity ?? true,
  };
}

function applyFunctionType(
  calleeType: Type,
  argTypes: Type[],
  range: Range,
  diagnostics: SyntaxDiagnostic[],
  enforceArity = true
): TypeResult {
  if (calleeType.kind !== TypeKind.Function) {
    if (!isUnknown(calleeType)) {
      addTypeError(diagnostics, range, `Attempted to call non-function type ${typeToString(calleeType)}`);
    }
    return [UNKNOWN];
  }

  const fn = calleeType as FunctionType;
  const expectedParams = fn.params.length;
  const hasVariadic = !!fn.variadic;
  if (enforceArity) {
    if (!hasVariadic && argTypes.length !== expectedParams) {
      addTypeError(diagnostics, range, `Expected ${expectedParams} arguments, got ${argTypes.length}`);
    }
    if (hasVariadic && argTypes.length < expectedParams) {
      addTypeError(diagnostics, range, `Expected at least ${expectedParams} arguments, got ${argTypes.length}`);
    }
  }

  for (let i = 0; i < fn.params.length; i++) {
    ensureAssignable(fn.params[i], argTypes[i] ?? UNKNOWN, range, diagnostics);
  }
  if (fn.variadic) {
    for (let i = fn.params.length; i < argTypes.length; i++) {
      ensureAssignable(fn.variadic, argTypes[i], range, diagnostics);
    }
  }

  return fn.returns.length ? fn.returns : [UNKNOWN];
}
