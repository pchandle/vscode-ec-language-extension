import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseText } from "../lang/parser";
import { resolveProgram } from "../lang/resolver";
import { typeCheckProgram } from "../lang/typeChecker";

describe("typeChecker", () => {
  it("type checks canonical sample without diagnostics", () => {
    const sample = fs.readFileSync(path.join(__dirname, "../../../../docs/canonical-expression-example.dla"), "utf8");
    const { program, diagnostics: syntaxDiagnostics } = parseText(sample);
    const { diagnostics: resolverDiagnostics } = resolveProgram(program);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.equal(
      syntaxDiagnostics.length + resolverDiagnostics.length + typeDiagnostics.length,
      0,
      `Expected no diagnostics, got syntax: ${syntaxDiagnostics
        .map((d) => d.message)
        .join(", ")}; resolver: ${resolverDiagnostics.map((d) => d.message).join(", ")}; type: ${typeDiagnostics
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
});
