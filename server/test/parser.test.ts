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

  it("parses nested weave-in if/else/end with output targets", () => {
    const text = `
if true then
  if false then
    1
  else
    2
  end -> inner_out
else
  3
end -> outer_out
`;
    const { diagnostics, program } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);

    const outerStmt = program.statements[0] as any;
    const outerIf = outerStmt.expression;
    assert.equal(outerIf.kind, "If");
    assert.equal(outerIf.targets.length, 1);
    assert.equal(outerIf.targets[0].lexeme, "outer_out");

    const innerStmt = outerIf.thenBlock.statements[0];
    const innerIf = innerStmt.expression;
    assert.equal(innerIf.kind, "If");
    assert.equal(innerIf.targets.length, 1);
    assert.equal(innerIf.targets[0].lexeme, "inner_out");
  });

  it("allows multiline parameter list close-paren followed by inline targets and ':'", () => {
    const text =
      "job /data/apply/example/default/x64(flow,\n" +
      "  asal,\n" +
      "  network_address\n" +
      "  ) result_code, success_flow, failure_flow:\n" +
      "  flow -> { }\n" +
      "end\n";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("parses arithmetic arguments containing '-1' without requiring signed integer tokens", () => {
    const text = "min(bytes_out_len - 1, number_of_bytes_to_copy -1) -> initial_target_pointer_offset";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("keeps typed parameter annotations invalid", () => {
    const text = "job /data/example/default/x64(flow::/data/flow) out:\nend";
    const { diagnostics } = parseText(text);
    assert.ok(diagnostics.length > 0, "expected diagnostics for typed parameter annotation");
  });

  it("allows line continuation in call arguments with backslash-newline", () => {
    const text =
      "sub /data/new/currency/reserve@aptissio($, 18,\\\n" +
      "  len(SYMBOL),\\\n" +
      "  len(TICKER),\\\n" +
      "  len(DESC)\\\n" +
      ") -> out\n";
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("allows multiline expressions inside call arguments without backslash continuation", () => {
    const text =
      'sub /data/write/constant/default/linux-x64($, "A" +\n' +
      '  "B" +\n' +
      '  "C")\n';
    const { diagnostics } = parseText(text);
    assert.equal(diagnostics.length, 0, `Expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("parses unqualified slash classifications after 'sub'", () => {
    const text = `
sub check/flag($, cfg_enable_debug) -> {
  sub /system/log/constant($, "x")
}, _
`;
    const { program, diagnostics } = parseText(text);
    const parseErrors = diagnostics.filter((d) => /Expected/.test(d.message));
    assert.equal(parseErrors.length, 0, `expected no parse errors, got ${parseErrors.map((d) => d.message).join(", ")}`);

    const stmt: any = program.statements[0];
    assert.equal(stmt.classification?.lexeme, "check/flag");
    assert.ok(Array.isArray(stmt.callArgs) && stmt.callArgs.length === 2, "expected call args for check/flag");
  });
});
