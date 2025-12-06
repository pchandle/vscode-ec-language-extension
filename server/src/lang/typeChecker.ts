import { Range } from "vscode-languageserver";
import { RemoteContractSpec } from "../gatewayClient";
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

export type TypeResult = Type[];

export interface TypeAtPosition {
  range: Range;
  types: TypeResult;
}

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

export function typeCheckProgram(
  program: ProgramNode,
  options?: { collectTypes?: boolean; contractSpecs?: Record<string, RemoteContractSpec> }
): { diagnostics: SyntaxDiagnostic[]; types?: TypeAtPosition[] } {
  const diagnostics: SyntaxDiagnostic[] = [];
  const types: TypeAtPosition[] | undefined = options?.collectTypes ? [] : undefined;
  const scope = makeScope();
  for (const stmt of program.statements) {
    typeCheckStatement(stmt, scope, diagnostics, types, options?.contractSpecs);
  }
  return { diagnostics, types };
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

export function typeToString(type: Type): string {
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

export function formatFunctionType(type: FunctionType): string {
  const params: string[] = type.params.map(typeToDisplayString);
  if (type.variadic) {
    params.push("..." + typeToDisplayString(type.variadic));
  }
  const returns = type.returns.map(typeToDisplayString);
  return `(${params.join(", ")}) -> (${returns.join(", ") || "UNKNOWN"})`;
}

export function typeToDisplayString(type: Type): string {
  if (type.kind === TypeKind.Function) {
    return formatFunctionType(type);
  }
  return typeToString(type);
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

function recordTypes(range: Range, result: TypeResult, collector?: TypeAtPosition[]) {
  if (!collector) return;
  collector.push({ range, types: result });
}

type SpecTerm = { type?: string; protocol?: string } | undefined;

function specTermToType(term: SpecTerm): Type {
  if (!term) return UNKNOWN;
  const t = (term.type || "").toLowerCase();
  switch (t) {
    case "integer":
      return INTEGER;
    case "string":
      return STRING;
    case "boolean":
      return BOOLEAN;
    case "abstraction":
      return term.protocol ? { kind: TypeKind.Classification, classification: term.protocol } : UNKNOWN;
    case "classification":
      return term.protocol ? { kind: TypeKind.Classification, classification: term.protocol } : UNKNOWN;
    default:
      if (term.type && term.type.startsWith("/")) {
        return { kind: TypeKind.Classification, classification: term.type };
      }
      return UNKNOWN;
  }
}

function recordTokenType(token: Token, scope: TypeScope, collector?: TypeAtPosition[]) {
  const binding = scope.bindings.get(token.lexeme);
  if (binding) {
    recordTypes(token.range, [binding.type], collector);
  }
}

function typeCheckStatement(
  stmt: Statement,
  scope: TypeScope,
  diagnostics: SyntaxDiagnostic[],
  collector?: TypeAtPosition[],
  contractSpecs?: Record<string, RemoteContractSpec>
) {
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
      typeCheckBlock(job.body, jobScope, diagnostics, collector, contractSpecs);
      for (const param of job.params) {
        recordTokenType(param, jobScope, collector);
      }
      for (const target of job.targets) {
        recordTokenType(target, jobScope, collector);
      }
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
      typeCheckBlock(def.body, defScope, diagnostics, collector, contractSpecs);

      placeholder.params = def.params.map((p) => lookup(defScope, p.lexeme)?.type ?? UNKNOWN);
      placeholder.returns = def.targets.map((t) => lookup(defScope, t.lexeme)?.type ?? UNKNOWN);
      recordTypes(def.name.range, [placeholder], collector);
      for (const param of def.params) {
        recordTokenType(param, defScope, collector);
      }
      for (const target of def.targets) {
        recordTokenType(target, defScope, collector);
      }
      return;
    }
    case NodeKind.Statement: {
      const classification = (stmt as any).classification?.lexeme;
      let spec = classification ? contractSpecs?.[classification] : undefined;
      if (!spec && classification && contractSpecs) {
        const key = Object.keys(contractSpecs).find((k) => k.startsWith(classification));
        if (key) {
          spec = contractSpecs[key];
        }
      }
      if (!spec && contractSpecs) {
        const keys = Object.keys(contractSpecs);
        if (keys.length === 1) {
          spec = contractSpecs[keys[0]];
        }
      }
      const obligations = spec?.obligations ?? [];
      let specResultTypes: Type[] = [];
      if (obligations.length && stmt.targets.length) {
        let obligationIndex = 0;
        specResultTypes = stmt.targets.map((t) => {
          if (t.lexeme === "_") return UNKNOWN;
          const term = obligations[obligationIndex] as SpecTerm;
          obligationIndex = Math.min(obligationIndex + 1, obligations.length);
          return specTermToType(term);
        });
      }

      const exprTypes =
        specResultTypes.length > 0
          ? specResultTypes
          : typeCheckExpression(stmt.expression as ExpressionNode | null, scope, diagnostics, collector, contractSpecs);
      const targetCount = stmt.targets.length;
      const resultCount = exprTypes.length;

      let assignmentTypes: Type[] = [];
      if (targetCount > 0) {
        if (resultCount === targetCount) {
          assignmentTypes = exprTypes;
        } else if (resultCount === 1 && targetCount > 1) {
          assignmentTypes = new Array(targetCount).fill(exprTypes[0]);
        } else if (resultCount === 0 && specResultTypes.length === 0) {
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
        recordTokenType(target, scope, collector);
      }

      if (stmt.block) {
        const scopeBinding = scope.bindings.get("$");
        const originalScopeType = scopeBinding?.type ?? UNKNOWN;
        const incoming = exprTypes[0] ?? originalScopeType;
        if (scopeBinding) {
          scopeBinding.type = incoming;
        }
        typeCheckBlock(stmt.block, scope, diagnostics, collector, contractSpecs);
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

function typeCheckBlock(
  block: BlockNode,
  scope: TypeScope,
  diagnostics: SyntaxDiagnostic[],
  collector?: TypeAtPosition[],
  contractSpecs?: Record<string, RemoteContractSpec>
): Map<string, Type> {
  for (const stmt of block.statements) {
    typeCheckStatement(stmt, scope, diagnostics, collector, contractSpecs);
  }
  const declared = new Map<string, Type>();
  for (const [name, binding] of scope.bindings.entries()) {
    if (name === "$") continue;
    declared.set(name, binding.type);
  }
  return declared;
}

function typeCheckExpression(
  expr: ExpressionNode | IfNode | null,
  scope: TypeScope,
  diagnostics: SyntaxDiagnostic[],
  collector?: TypeAtPosition[],
  contractSpecs?: Record<string, RemoteContractSpec>
): TypeResult {
  if (!expr) return [];
  switch (expr.kind) {
    case NodeKind.Identifier: {
      const binding = lookup(scope, (expr as any).token.lexeme);
      const type = binding?.type ?? UNKNOWN;
      recordTypes((expr as any).token.range, [type], collector);
      return [type];
    }
    case NodeKind.Scope: {
      const scopeRef = expr as ScopeRefNode;
      const binding = lookup(scope, scopeRef.token.lexeme);
      const type = binding?.type ?? SCOPE_TYPE;
      recordTypes(scopeRef.token.range, [type], collector);
      return [type];
    }
    case NodeKind.Classification:
      recordTypes((expr as any).token.range, [{ kind: TypeKind.Classification, classification: (expr as any).token.lexeme }], collector);
      return [{ kind: TypeKind.Classification, classification: (expr as any).token.lexeme }];
    case NodeKind.Literal:
      const literalType = typeFromLiteral((expr as any).token);
      recordTypes((expr as any).token.range, [literalType], collector);
      return [literalType];
    case NodeKind.Unary: {
      const operandTypes = typeCheckExpression((expr as any).operand, scope, diagnostics, collector, contractSpecs);
      const operandType = operandTypes[0] ?? UNKNOWN;
      const op = (expr as any).operator;
      if (op.kind === TokenKind.Bang) {
        ensureBoolean(operandType, op.range, diagnostics);
        recordTypes(expr.range, [BOOLEAN], collector);
        return [BOOLEAN];
      }
      if (op.kind === TokenKind.Plus || op.kind === TokenKind.Minus) {
        ensureInteger(operandType, op.range, diagnostics);
        recordTypes(expr.range, [INTEGER], collector);
        return [INTEGER];
      }
      recordTypes(expr.range, [UNKNOWN], collector);
      return [UNKNOWN];
    }
    case NodeKind.Binary: {
      const binary = expr as any;
      const left = typeCheckExpression(binary.left, scope, diagnostics, collector, contractSpecs)[0] ?? UNKNOWN;
      const right = typeCheckExpression(binary.right, scope, diagnostics, collector, contractSpecs)[0] ?? UNKNOWN;
      const op = binary.operator.kind;
      let result: TypeResult = [UNKNOWN];
      switch (op) {
        case TokenKind.Plus: {
          if (!isUnknown(left) && !isUnknown(right)) {
            if (left.kind === TypeKind.Integer && right.kind === TypeKind.Integer) {
              result = [INTEGER];
              break;
            }
            if (left.kind === TypeKind.String && right.kind === TypeKind.String) {
              result = [STRING];
              break;
            }
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Operator '+' requires INTEGER+INTEGER or STRING+STRING, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          break;
        }
        case TokenKind.Minus:
          ensureInteger(left, binary.operator.range, diagnostics);
          ensureInteger(right, binary.operator.range, diagnostics);
          result = [INTEGER];
          break;
        case TokenKind.Star: {
          if (!isUnknown(left) && !isUnknown(right)) {
            const leftIsInt = left.kind === TypeKind.Integer;
            const rightIsInt = right.kind === TypeKind.Integer;
            const leftIsString = left.kind === TypeKind.String;
            const rightIsString = right.kind === TypeKind.String;
            if (leftIsInt && rightIsInt) {
              result = [INTEGER];
              break;
            }
            if ((leftIsInt && rightIsString) || (leftIsString && rightIsInt)) {
              result = [STRING];
              break;
            }
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Operator '*' requires INTEGER*INTEGER or STRING*INTEGER, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          break;
        }
        case TokenKind.Slash:
        case TokenKind.Percent:
          ensureInteger(left, binary.operator.range, diagnostics);
          ensureInteger(right, binary.operator.range, diagnostics);
          result = [INTEGER];
          break;
        case TokenKind.EqualsEquals:
        case TokenKind.BangEquals: {
          if (!isUnknown(left) && !isUnknown(right) && left.kind !== right.kind) {
            addTypeError(
              diagnostics,
              binary.operator.range,
              `Comparison requires matching types, got ${typeToString(left)} and ${typeToString(right)}`
            );
          }
          result = [BOOLEAN];
          break;
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
          result = [BOOLEAN];
          break;
        }
        case TokenKind.AndAnd:
        case TokenKind.OrOr:
          ensureBoolean(left, binary.operator.range, diagnostics);
          ensureBoolean(right, binary.operator.range, diagnostics);
          result = [BOOLEAN];
          break;
        default:
          result = [UNKNOWN];
      }
      recordTypes(expr.range, result, collector);
      return result;
    }
    case NodeKind.Qualified: {
      const qualified = expr as QualifiedNode;
      const types = typeCheckExpression(qualified.base, scope, diagnostics, collector, contractSpecs);
      recordTypes(expr.range, types, collector);
      return types;
    }
    case NodeKind.Call: {
      const call = expr as any;
      const calleeId = extractIdentifier(call.callee);
      const builtin = calleeId ? BUILTIN_FUNCTIONS[calleeId.toLowerCase()] : undefined;
      const calleeType =
        builtin
          ? builtinToFunctionType(builtin)
          : typeCheckExpression(call.callee, scope, diagnostics, collector, contractSpecs)[0] ?? UNKNOWN;

      const argTypes = call.args.map(
        (arg: ExpressionNode) => typeCheckExpression(arg, scope, diagnostics, collector, contractSpecs)[0] ?? UNKNOWN
      );
      const returns = applyFunctionType(calleeType, argTypes, call.range, diagnostics, builtin?.enforceArity ?? true);
      recordTypes(expr.range, returns, collector);
      return returns;
    }
    case NodeKind.If: {
      const ifNode = expr as IfNode;
      const conditionTypes = typeCheckExpression(ifNode.condition, scope, diagnostics, collector, contractSpecs);
      ensureBoolean(conditionTypes[0] ?? UNKNOWN, ifNode.range, diagnostics);

      const thenScope = makeScope(scope, lookup(scope, "$")?.type);
      const elseScope = makeScope(scope, lookup(scope, "$")?.type);
      const thenBindings = typeCheckBlock(ifNode.thenBlock, thenScope, diagnostics, collector, contractSpecs);
      const elseBindings = ifNode.elseBlock
        ? typeCheckBlock(ifNode.elseBlock, elseScope, diagnostics, collector, contractSpecs)
        : new Map<string, Type>();
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
      const results = new Array(outputCount).fill(UNKNOWN) as TypeResult;
      recordTypes(ifNode.range, results, collector);
      return results;
    }
    default:
      recordTypes((expr as any).range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, [UNKNOWN], collector);
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
