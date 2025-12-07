import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseText } from "../lang/parser";
import { resolveProgram } from "../lang/resolver";
import { TypeKind, typeCheckProgram } from "../lang/typeChecker";

describe("typeChecker", () => {
  it("parses and resolves canonical sample without syntax/resolver diagnostics", () => {
    const sample = fs.readFileSync(path.join(__dirname, "../../../../docs/canonical-expression-example.dla"), "utf8");
    const { program, diagnostics: syntaxDiagnostics } = parseText(sample);
    const { diagnostics: resolverDiagnostics } = resolveProgram(program);
    assert.equal(
      syntaxDiagnostics.length + resolverDiagnostics.length,
      0,
      `Expected no syntax/resolver diagnostics, got syntax: ${syntaxDiagnostics.map((d) => d.message).join(", ")}; resolver: ${resolverDiagnostics
        .map((d) => d.message)
        .join(", ")}`
    );
  });

  it("flags operator/operand mismatches", () => {
    const text = '1 + "hi" -> out';
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Operator '+' requires")),
      `Expected type diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("checks call arity for defs", () => {
    const text = "def foo(a) r:\n  a -> r\nend\nfoo(1, 2) -> out";
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Expected 1 arguments")),
      `Expected arity diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("detects mismatched branch assignments", () => {
    const text = "if true then\n  1 -> a\nelse\n  \"s\" -> a\nend";
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Branches assign different types")),
      `Expected branch merge diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("errors on string relational comparisons", () => {
    const text = "\"a\" < \"b\" -> out";
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Relational operators require INTEGER operands")),
      `Expected relational diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("emits diagnostics and unknown types when contract spec is missing", () => {
    const text = "job /missing/spec() OUT:\nend";
    const { program } = parseText(text);
    const { diagnostics, types } = typeCheckProgram(program, { collectTypes: true });
    assert.ok(
      diagnostics.some((d) => d.message.includes("Unknown contract specification for '/missing/spec'")),
      `Expected unknown contract diagnostic, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
    const job = program.statements.find((s: any) => s.kind === "Job") as any;
    const target = job.targets[0];
    const match = types?.find(
      (t) =>
        t.range.start.line === target.range.start.line &&
        t.range.start.character === target.range.start.character &&
        t.range.end.line === target.range.end.line &&
        t.range.end.character === target.range.end.character
    );
    assert.ok(match, "expected a type entry for job target");
    assert.equal(match!.types[0].kind, TypeKind.Unknown, "expected target type to remain UNKNOWN without spec");
  });

  it("keeps obligations unknown when a missing-spec job has assignments", () => {
    const text = "job /missing/spec(x) OUT:\n  1 -> OUT\nend";
    const { program } = parseText(text);
    const { diagnostics, types } = typeCheckProgram(program, { collectTypes: true });
    assert.ok(
      diagnostics.some((d) => d.message.includes("Unknown contract specification for '/missing/spec'")),
      "expected missing spec diagnostic"
    );
    const job: any = program.statements.find((s: any) => s.kind === "Job");
    const target = job.targets[0];
    const match = types?.find(
      (t) =>
        t.range.start.line === target.range.start.line &&
        t.range.start.character === target.range.start.character &&
        t.range.end.line === target.range.end.line &&
        t.range.end.character === target.range.end.character
    );
    assert.ok(match, "expected a type entry for job target");
    assert.equal(match!.types[0].kind, TypeKind.Unknown, "expected target to stay UNKNOWN when spec is missing");
  });

  it("validates requirement and obligation counts against the spec", () => {
    const spec = {
      requirements: [
        { name: "flow", type: "/data/flow/default/x64" },
        { name: "min", type: "integer" },
        { name: "max", type: "integer" }
      ],
      obligations: [{ type: "/data/integer/default/x64" }]
    };
    const text = `
sub /data/new/integer/default/x64(1, 10) -> OUTER_INT
sub /data/new/integer/default/x64(flow, 1, 10) -> OUTER_INT2, _
sub /data/new/integer/default/x64(flow, 1, 10)
sub /data/new/integer/default/x64(flow, 1, 10, 255)
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      contractSpecs: { "/data/new/integer/default/x64": spec as any }
    });
    const reqErrors = diagnostics.filter((d) => d.message.includes("Requirement count mismatch"));
    const oblErrors = diagnostics.filter((d) => d.message.includes("Obligation count mismatch"));
    assert.equal(reqErrors.length, 2, `expected 2 requirement count errors, got ${reqErrors.length}`);
    assert.equal(oblErrors.length, 3, `expected 3 obligation count errors, got ${oblErrors.length}`);
  });
});
