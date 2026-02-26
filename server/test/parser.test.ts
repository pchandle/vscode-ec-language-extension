import { strict as assert } from "assert";
import { parseText } from "../lang/parser";
import { lexText } from "../lang/lexer";
import { TokenKind } from "../lang/tokens";
import * as fs from "fs";
import * as path from "path";

describe("lexer", () => {
  it("tokenizes canonical example", () => {
    const sample = fs.readFileSync(path.join(__dirname, "../../../../docs/examples/canonical-expression-example.dla"), "utf8");
    const { tokens, diagnostics } = lexText(sample);
    assert.equal(diagnostics.length, 0, `Expected no lex diagnostics, got ${diagnostics[0]?.message}`);
    const hasJob = tokens.some((t) => t.kind === TokenKind.Keyword && t.lexeme.toLowerCase() === "job");
    const hasClassification = tokens.some((t) => t.kind === TokenKind.Classification);
    const hasIf = tokens.some((t) => t.kind === TokenKind.Keyword && t.lexeme.toLowerCase() === "if");
    assert.ok(hasJob, "missing job keyword");
    assert.ok(hasClassification, "missing classification token");
    assert.ok(hasIf, "missing if keyword");
  });

  it("does not enter pending classification mode for identifiers like SUBMIT_*", () => {
    const sample = "job /example/test(SUBMIT_BTN_HEADING):\nend";
    const { tokens, diagnostics } = lexText(sample);
    assert.equal(diagnostics.length, 0, `Expected no lex diagnostics, got ${diagnostics[0]?.message}`);
    const emptyClassification = tokens.find((t) => t.kind === TokenKind.Classification && t.lexeme.length === 0);
    assert.ok(!emptyClassification, "did not expect empty classification token");
  });
});

describe("parser", () => {
  it("parses canonical example without syntax errors", () => {
    const sample = fs.readFileSync(path.join(__dirname, "../../../../docs/examples/canonical-expression-example.dla"), "utf8");
    const { diagnostics, program } = parseText(sample);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
    assert.ok(program.statements.length > 0, "expected statements in program");
  });

  it("parses scope reference as primary", () => {
    const { diagnostics } = parseText("job /example/foo(x):\n  sub /data/new($) -> out\nend");
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("reports unterminated string", () => {
    const { diagnostics } = parseText('job /example/test(x):\n  "unterminated\nend');
    assert.ok(diagnostics.some((d) => d.message.toLowerCase().includes("unterminated string")), "expected unterminated string diagnostic");
  });

  it("requires ':' after job signature", () => {
    const { diagnostics } = parseText("job /example/test(x)\n  false -> debug_flag\nend");
    assert.ok(
      diagnostics.some((d) => d.message === "Expected ':' after job signature"),
      `Expected ':' diagnostic, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("does not consume first body statement as job header target when ':' is missing", () => {
    const { diagnostics, program } = parseText("job /example/test(x)\n  false -> debug_flag\nend");
    assert.ok(
      diagnostics.some((d) => d.message === "Expected ':' after job signature"),
      `Expected ':' diagnostic, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
    const job = program.statements[0] as any;
    assert.equal(job.targets.length, 0, "expected no inline targets for missing-colon job header");
    const bodyHasDebugFlagTarget = job.body.statements.some((s: any) =>
      Array.isArray(s.targets) && s.targets.some((t: any) => t.lexeme === "debug_flag")
    );
    assert.ok(bodyHasDebugFlagTarget, "expected body assignment to debug_flag to remain in job body");
  });

  it("allows multiline job header targets before ':'", () => {
    const text =
      "job /example/test(x) out1,\n" +
      "  out2,\n" +
      "  out3:\n" +
      "  1 -> out1\n" +
      "end";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("allows ':' on its own line for job headers", () => {
    const text =
      "job /example/test(x) out1,\n" +
      "  out2\n" +
      ":\n" +
      "  1 -> out1\n" +
      "end";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("allows trailing comma before block in target list", () => {
    const text = "sub /data/new/test/default/x64($) -> _, {\n  1 -> out\n}";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("allows trailing comma newline continuation in target list", () => {
    const text = "sub /data/new/test/default/x64($) -> first,\n  second\n";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });
});
