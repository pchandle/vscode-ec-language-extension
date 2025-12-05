"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const parser_1 = require("../src/lang/parser");
const lexer_1 = require("../src/lang/lexer");
const tokens_1 = require("../src/lang/tokens");
const fs = require("fs");
const path = require("path");
describe("lexer", () => {
    it("tokenizes canonical example", () => {
        const sample = fs.readFileSync(path.join(__dirname, "../../docs/canonical-expression-example.dla"), "utf8");
        const { tokens, diagnostics } = (0, lexer_1.lexText)(sample);
        assert_1.strict.equal(diagnostics.length, 0, `Expected no lex diagnostics, got ${diagnostics[0]?.message}`);
        const hasJob = tokens.some((t) => t.kind === tokens_1.TokenKind.Keyword && t.lexeme.toLowerCase() === "job");
        const hasClassification = tokens.some((t) => t.kind === tokens_1.TokenKind.Classification);
        const hasIf = tokens.some((t) => t.kind === tokens_1.TokenKind.Keyword && t.lexeme.toLowerCase() === "if");
        assert_1.strict.ok(hasJob, "missing job keyword");
        assert_1.strict.ok(hasClassification, "missing classification token");
        assert_1.strict.ok(hasIf, "missing if keyword");
    });
});
describe("parser", () => {
    it("parses canonical example without syntax errors", () => {
        const sample = fs.readFileSync(path.join(__dirname, "../../docs/canonical-expression-example.dla"), "utf8");
        const { diagnostics, program } = (0, parser_1.parseText)(sample);
        assert_1.strict.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
        assert_1.strict.ok(program.statements.length > 0, "expected statements in program");
    });
    it("parses scope reference as primary", () => {
        const { diagnostics } = (0, parser_1.parseText)("job /example/foo(x)\n  sub /data/new($) -> out\nend");
        assert_1.strict.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
    });
    it("reports unterminated string", () => {
        const { diagnostics } = (0, parser_1.parseText)('job /example/test(x)\n  "unterminated\nend');
        assert_1.strict.ok(diagnostics.some((d) => d.message.toLowerCase().includes("unterminated string")), "expected unterminated string diagnostic");
    });
});
//# sourceMappingURL=parser.test.js.map