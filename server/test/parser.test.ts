import { strict as assert } from "assert";
import { parseText } from "../src/lang/parser";
import { lexText } from "../src/lang/lexer";
import { TokenKind } from "../src/lang/tokens";
import * as fs from "fs";
import * as path from "path";

describe("lexer", () => {
  it("tokenizes canonical example", () => {
    const sample = fs.readFileSync(path.join(__dirname, "../../docs/canonical-expression-example.dla"), "utf8");
    const { tokens, diagnostics } = lexText(sample);
    assert.equal(diagnostics.length, 0, `Expected no lex diagnostics, got ${diagnostics[0]?.message}`);
    const hasJob = tokens.some((t) => t.kind === TokenKind.Keyword && t.lexeme.toLowerCase() === "job");
    const hasClassification = tokens.some((t) => t.kind === TokenKind.Classification);
    const hasIf = tokens.some((t) => t.kind === TokenKind.Keyword && t.lexeme.toLowerCase() === "if");
    assert.ok(hasJob, "missing job keyword");
    assert.ok(hasClassification, "missing classification token");
    assert.ok(hasIf, "missing if keyword");
  });
});

describe("parser", () => {
  it("parses canonical example without syntax errors", () => {
    const sample = fs.readFileSync(path.join(__dirname, "../../docs/canonical-expression-example.dla"), "utf8");
    const { diagnostics, program } = parseText(sample);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
    assert.ok(program.statements.length > 0, "expected statements in program");
  });

  it("parses scope reference as primary", () => {
    const { diagnostics } = parseText("job /example/foo(x)\n  sub /data/new($) -> out\nend");
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("reports unterminated string", () => {
    const { diagnostics } = parseText('job /example/test(x)\n  "unterminated\nend');
    assert.ok(diagnostics.some((d) => d.message.toLowerCase().includes("unterminated string")), "expected unterminated string diagnostic");
  });
});
