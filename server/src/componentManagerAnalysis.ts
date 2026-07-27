import { Range } from "vscode-languageserver";
import { parseText } from "./lang/parser";
import { resolveProgram } from "./lang/resolver";
import { typeCheckProgram } from "./lang/typeChecker";
import { normalizeContractClassification, normalizeProtocolClassification } from "./lang/normalization";
import { JobNode, NodeKind, StatementNode } from "./lang/ast";

export type ComponentManagerRange = Range;

export type ComponentManagerStatement = {
  role: "host" | "join";
  classification: string | null;
  rawClassification?: string;
  requirements: Array<{ label: string; range: ComponentManagerRange }>;
  obligations: Array<{ label: string; range: ComponentManagerRange }>;
  range: ComponentManagerRange;
};

export type ComponentManagerJob = {
  classification: string | null;
  rawClassification?: string;
  requirements: Array<{ label: string; range: ComponentManagerRange }>;
  obligations: Array<{ label: string; range: ComponentManagerRange }>;
  range: ComponentManagerRange;
  bodyRange: ComponentManagerRange;
  statements: ComponentManagerStatement[];
};

export type ComponentManagerExpressionAnalysis = {
  jobs: ComponentManagerJob[];
  diagnostics: Array<{ message: string; range: ComponentManagerRange }>;
};

type Defaults = { layer: string; variation: string; platform: string };

function defaultsFromProgram(text: string): Defaults {
  // Defaults are only used by the language service normaliser.  Expression
  // structure itself always comes from the parser below.
  const match = text.match(/(^|\n)\s*defaults:\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)/i);
  return match
    ? { layer: match[2] ?? "", variation: match[3] ?? "", platform: match[4] ?? "" }
    : { layer: "", variation: "", platform: "" };
}

function label(token: any): { label: string; range: ComponentManagerRange } {
  return { label: token.lexeme, range: token.range };
}

/**
 * A compact, transport-safe projection of the existing AST.  The extension
 * host deliberately does not reparse expressions; it asks the language
 * service for this projection instead.
 */
export function analyseComponentManagerExpression(text: string): ComponentManagerExpressionAnalysis {
  const { program, diagnostics: syntaxDiagnostics } = parseText(text);
  const resolverDiagnostics = resolveProgram(program).diagnostics;
  const defaults = defaultsFromProgram(text);
  const typeDiagnostics = typeCheckProgram(program, { defaults }).diagnostics;
  const jobs: ComponentManagerJob[] = [];

  for (const statement of program.statements) {
    if (statement.kind !== NodeKind.Job) continue;
    const job = statement as JobNode;
    const rawClassification = job.classification?.lexeme;
    const statements: ComponentManagerStatement[] = [];
    for (const bodyStatement of job.body.statements) {
      if (bodyStatement.kind !== NodeKind.Statement) continue;
      const invocation = bodyStatement as StatementNode;
      const role = invocation.keyword?.lexeme?.toLowerCase();
      if ((role !== "host" && role !== "join") || !invocation.classification) continue;
      const rawProtocol = invocation.classification.lexeme;
      statements.push({
        role,
        rawClassification: rawProtocol,
        classification: normalizeProtocolClassification(rawProtocol, defaults),
        requirements: (invocation.callArgs ?? [])
          .filter((arg: any) => arg?.token)
          .map((arg: any) => label(arg.token)),
        obligations: (invocation.targets ?? []).map(label),
        range: invocation.range,
      });
    }
    jobs.push({
      rawClassification,
      classification: rawClassification ? normalizeContractClassification(rawClassification, defaults) : null,
      requirements: job.params.map(label),
      obligations: job.targets.map(label),
      range: job.range,
      bodyRange: job.body.range,
      statements,
    });
  }

  return {
    jobs,
    diagnostics: [...syntaxDiagnostics, ...resolverDiagnostics, ...typeDiagnostics].map((diagnostic) => ({
      message: diagnostic.message,
      range: diagnostic.range,
    })),
  };
}
