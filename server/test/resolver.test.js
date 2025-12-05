"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const fs = require("fs");
const path = require("path");
const parser_1 = require("../src/lang/parser");
const resolver_1 = require("../src/lang/resolver");
describe("resolver", () => {
    it("resolves canonical sample without diagnostics", () => {
        const sample = fs.readFileSync(path.join(__dirname, "../../docs/canonical-expression-example.dla"), "utf8");
        const { program, diagnostics: syntaxDiagnostics } = (0, parser_1.parseText)(sample);
        const { diagnostics: resolverDiagnostics } = (0, resolver_1.resolveProgram)(program);
        assert_1.strict.equal(syntaxDiagnostics.length + resolverDiagnostics.length, 0, `Expected no diagnostics, got syntax: ${syntaxDiagnostics
            .map((d) => d.message)
            .join(", ")}; resolver: ${resolverDiagnostics.map((d) => d.message).join(", ")}`);
    });
    it("reports duplicate declarations in the same scope", () => {
        const text = "job /example/test(x)\n  1 -> a\n  2 -> a\nend";
        const { program } = (0, parser_1.parseText)(text);
        const { diagnostics } = (0, resolver_1.resolveProgram)(program);
        assert_1.strict.ok(diagnostics.some((d) => d.message.toLowerCase().includes("duplicate")), "expected duplicate diagnostic");
    });
    it("allows shadowing in child scopes", () => {
        const text = "job /example/test(x)\n  if true then\n    1 -> x\n  else\n    2 -> y\n  end\n  x -> ok\nend";
        const { program, diagnostics: syntaxDiagnostics } = (0, parser_1.parseText)(text);
        const { diagnostics } = (0, resolver_1.resolveProgram)(program);
        assert_1.strict.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
        assert_1.strict.equal(diagnostics.length, 0, `expected no resolver diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
    });
    it("reports undefined identifiers", () => {
        const text = "job /example/test()\n  foo + 1 -> bar\nend";
        const { program } = (0, parser_1.parseText)(text);
        const { diagnostics } = (0, resolver_1.resolveProgram)(program);
        assert_1.strict.ok(diagnostics.some((d) => d.message.includes("Undefined name 'foo'")), "expected undefined name diagnostic for foo");
    });
});
//# sourceMappingURL=resolver.test.js.map