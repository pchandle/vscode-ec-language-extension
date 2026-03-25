/// <reference path="./globals.d.ts" />
import { expect } from "chai";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildFormattingInput, formatDocument, formatDocumentRange, planFormatting } from "../src/formatting";

function createDocument(text: string): TextDocument {
  return TextDocument.create("file:///formatting.dla", "emergent", 1, text);
}

function applyEdits(document: TextDocument, text: string): string {
  const edits = formatDocument(document);
  return TextDocument.applyEdits(document, edits).replace(/\r\n/g, "\n");
}

describe("formatting", () => {
  it("builds a parsed formatter input model for valid syntax", () => {
    const input = createDocument("job /example/foo(x):\n  sub /data/new($) -> out\nend");
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.syntaxDiagnostics).to.deep.equal([]);
    expect(model.lines[0].coveredBySyntax).to.equal(true);
    expect(model.lines[1].coveredBySyntax).to.equal(true);
  });

  it("records recovery mode when syntax diagnostics are present", () => {
    const input = createDocument("job /example/test(x)\n  false -> debug_flag\nend");
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("recovery");
    expect(model.syntaxDiagnostics.some((item) => item.message.includes("Expected ':' after job signature"))).to.equal(true);
    expect(model.lines[0].intersectsDiagnostic).to.equal(false);
    expect(model.lines[0].safeToFormat).to.equal(true);
    expect(model.lines[1].intersectsDiagnostic).to.equal(true);
    expect(model.lines[1].protectedRanges).to.deep.equal([{ startCharacter: 2, endCharacter: 7 }]);
    expect(model.lines[1].safeToFormat).to.equal(true);
  });

  it("matches current spacing cleanup behavior", () => {
    const input = [
      "job /example/test(a,b):",
      "  value1  ,value2  ->out2  ",
      "// keep   comment spacing",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(a, b):",
        "  value1, value2 -> out2",
        "// keep   comment spacing",
        "end",
      ].join("\n")
    );
  });

  it("returns no edits for already formatted input", () => {
    const input = [
      "host /example/test(a, b) -> out",
      "",
      "// keep   comment spacing",
      "end",
    ].join("\n");

    expect(formatDocument(createDocument(input))).to.deep.equal([]);
  });

  it("preserves malformed structure while applying current whitespace rules", () => {
    const input = [
      "sub /broken/test(a,b)->",
      "  value1  ,value2  ->  ",
      "end  ",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "sub /broken/test(a, b) ->",
        "  value1, value2 ->",
        "end",
      ].join("\n")
    );
  });

  it("formats only the selected lines for range formatting", () => {
    const input = [
      "job /example/test(a,b):",
      "  value1  ,value2  ->out2  ",
      "// keep   comment spacing",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 1)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(a,b):",
        "  value1, value2 -> out2",
        "// keep   comment spacing",
        "end",
      ].join("\n")
    );
  });

  it("plans decisions with parse-mode metadata without changing parity behavior", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  ->out2  \nend");
    const model = buildFormattingInput(document);
    const decisions = planFormatting(model, { startLine: 1, endLine: 1 });

    expect(decisions).to.have.length(1);
    expect(decisions[0].parseMode).to.equal("recovery");
    expect(decisions[0].safeToFormat).to.equal(true);
    expect(decisions[0].formattedText).to.equal("  value1  , value2 -> out2");
  });

  it("formats recovery-safe prefixes while preserving the ambiguous suffix", () => {
    const document = createDocument("job /example/test(a,b)\n  value1  ,value2  ->out2  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(a, b)",
        "  value1  , value2 -> out2",
        "end",
      ].join("\n")
    );
  });

  it("returns edits for the safe portion of a recovery range", () => {
    const document = createDocument("job /example/test(a,b)\n  value1  ,value2  ->out2  \nend");
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 1)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(a, b)",
        "  value1  , value2 -> out2",
        "end",
      ].join("\n")
    );
  });
});
