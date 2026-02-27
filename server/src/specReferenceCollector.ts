import { ProgramNode, Statement, StatementNode, ExpressionNode, IfNode, NodeKind, BlockNode } from "./lang/ast";
import { Defaults, normalizeContractClassification, normalizeProtocolClassification } from "./lang/normalization";

export type ClassificationKind = "contract" | "protocol";

export type CollectedSpecReferences = {
  classifications: Set<string>;
  classificationKinds: Map<string, ClassificationKind>;
  rawToNormalized: Map<string, string>;
};

function statementKind(stmt: StatementNode): ClassificationKind {
  const keyword = stmt.keyword?.lexeme?.toLowerCase?.();
  return keyword === "host" || keyword === "join" ? "protocol" : "contract";
}

function recordClassification(
  refs: CollectedSpecReferences,
  raw: string,
  kind: ClassificationKind,
  defaults: Defaults
): void {
  if (!raw) return;
  const normalized =
    kind === "protocol"
      ? normalizeProtocolClassification(raw, defaults)
      : normalizeContractClassification(raw, defaults);
  if (!normalized) return;

  refs.classifications.add(normalized);
  refs.classificationKinds.set(normalized, kind);
  refs.rawToNormalized.set(raw, normalized);
}

function visitBlock(block: BlockNode | undefined, refs: CollectedSpecReferences, defaults: Defaults): void {
  if (!block) return;
  for (const stmt of block.statements) {
    visitStatement(stmt, refs, defaults);
  }
}

function visitExpression(
  expr: ExpressionNode | IfNode | null | undefined,
  refs: CollectedSpecReferences,
  defaults: Defaults
): void {
  if (!expr) return;

  switch (expr.kind) {
    case NodeKind.If: {
      const ifExpr = expr as IfNode;
      visitExpression(ifExpr.condition, refs, defaults);
      visitBlock(ifExpr.thenBlock, refs, defaults);
      visitBlock(ifExpr.elseBlock, refs, defaults);
      return;
    }
    case NodeKind.Binary:
      visitExpression((expr as any).left, refs, defaults);
      visitExpression((expr as any).right, refs, defaults);
      return;
    case NodeKind.Unary:
      visitExpression((expr as any).operand, refs, defaults);
      return;
    case NodeKind.Call:
      visitExpression((expr as any).callee, refs, defaults);
      for (const arg of (expr as any).args ?? []) {
        visitExpression(arg, refs, defaults);
      }
      return;
    case NodeKind.Qualified:
      visitExpression((expr as any).base, refs, defaults);
      return;
    case NodeKind.ListLiteral:
      for (const el of (expr as any).elements ?? []) {
        visitExpression(el, refs, defaults);
      }
      return;
    default:
      return;
  }
}

function visitStatement(stmt: Statement, refs: CollectedSpecReferences, defaults: Defaults): void {
  if ((stmt as any).classification?.lexeme) {
    const raw = (stmt as any).classification.lexeme as string;
    const kind = stmt.kind === NodeKind.Statement ? statementKind(stmt as StatementNode) : "contract";
    recordClassification(refs, raw, kind, defaults);
  }

  if (stmt.kind === NodeKind.Statement) {
    const statement = stmt as StatementNode;
    visitExpression(statement.expression as any, refs, defaults);

    for (const arg of statement.callArgs ?? []) {
      visitExpression(arg as any, refs, defaults);
    }

    for (const obligation of statement.obligationOrder ?? []) {
      if ((obligation as any)?.kind === NodeKind.Block) {
        visitBlock(obligation as BlockNode, refs, defaults);
      }
    }

    visitBlock(statement.block, refs, defaults);
  }

  visitBlock((stmt as any).body, refs, defaults);
}

export function collectReferencedClassifications(program: ProgramNode, defaults: Defaults): CollectedSpecReferences {
  const refs: CollectedSpecReferences = {
    classifications: new Set<string>(),
    classificationKinds: new Map<string, ClassificationKind>(),
    rawToNormalized: new Map<string, string>(),
  };

  for (const stmt of program.statements) {
    visitStatement(stmt, refs, defaults);
  }

  return refs;
}
