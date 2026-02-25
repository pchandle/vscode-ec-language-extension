import { strict as assert } from "assert";
import { parseText } from "../lang/parser";
import { resolveProgram } from "../lang/resolver";

describe("resolver", () => {
  it("resolves simple sample without diagnostics", () => {
    const sample = "def foo(a) out:\n  a -> out\nend\nfoo(1) -> result";
    const { program, diagnostics: syntaxDiagnostics } = parseText(sample);
    const { diagnostics: resolverDiagnostics } = resolveProgram(program);
    assert.equal(
      syntaxDiagnostics.length + resolverDiagnostics.length,
      0,
      `Expected no diagnostics, got syntax: ${syntaxDiagnostics
        .map((d) => d.message)
        .join(", ")}; resolver: ${resolverDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("reports duplicate declarations in the same scope", () => {
    const text = "job /example/test(x):\n  1 -> a\n  2 -> a\nend";
    const { program } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.ok(diagnostics.some((d) => d.message.toLowerCase().includes("duplicate")), "expected duplicate diagnostic");
  });

  it("allows shadowing in child scopes", () => {
    const text = "job /example/test(x):\n  if true then\n    1 -> x\n  else\n    2 -> y\n  end\n  x -> ok\nend";
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    assert.equal(diagnostics.length, 0, `expected no resolver diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("reports undefined identifiers", () => {
    const text = "job /example/test():\n  foo(bar) -> out\nend";
    const { program } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.ok(diagnostics.some((d) => d.message.includes("Undefined name 'bar'")), "expected undefined name diagnostic for bar");
  });
});
