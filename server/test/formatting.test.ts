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

  it("falls back to diagnostic character spans when no token overlaps the recovery point", () => {
    const input = createDocument("job /example/test(a,b):\n  value1  ,value2 -> {\n  end");
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("recovery");
    expect(model.lines[2].intersectsDiagnostic).to.equal(true);
    expect(model.lines[2].protectedRanges).to.deep.equal([{ startCharacter: 5, endCharacter: 5 }]);
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

  it("preserves inline block comment text while formatting the safe prefix", () => {
    const input = [
      "job /example/test(a,b):",
      "  value1  ,value2  /* keep  , -> spacing */",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(a, b):",
        "  value1, value2  /* keep  , -> spacing */",
        "end",
      ].join("\n")
    );
  });

  it("preserves multiline block comments while formatting surrounding syntax", () => {
    const input = [
      "job /example/test(a,b):",
      "  /* keep  , -> spacing",
      "     and indentation */",
      "  value1  ,value2  ->out2  ",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(a, b):",
        "  /* keep  , -> spacing",
        "     and indentation */",
        "  value1, value2 -> out2",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents parsed brace blocks without changing malformed recovery behavior", () => {
    const input = [
      "job /example/test(x):",
      "  value  -> {",
      "sub /data/new($)->out",
      "  join /data/flow($) -> {",
      "$  ->inner",
      " }",
      "}",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    sub /data/new($) -> out",
        "    join /data/flow($) -> {",
        "      $ -> inner",
        "    }",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("indents standalone comments inside parsed brace blocks to the block depth", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "// keep   comment spacing",
      "  sub /data/new($)->out",
      "}",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    // keep   comment spacing",
        "    sub /data/new($) -> out",
        "  }",
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

  it("formats the selected portion of a parsed brace block using structural indentation", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "sub /data/new($)->out",
      "}",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 2, 3)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    sub /data/new($) -> out",
        "  }",
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
    expect(decisions[0].formattedText).to.equal("  value1, value2 -> out2");
  });

  it("preserves attached inline comments on malformed recovery lines", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  ->out2  // keep   comment spacing\nend");
    const model = buildFormattingInput(document);
    const decisions = planFormatting(model, { startLine: 1, endLine: 1 });

    expect(model.lines[1].protectedRanges).to.deep.equal([
      { startCharacter: 2, endCharacter: 8 },
      { startCharacter: 25, endCharacter: 52 },
    ]);
    expect(decisions[0].formattedText).to.equal("  value1, value2 -> out2  // keep   comment spacing");
  });

  it("marks standalone comment lines adjacent to malformed recovery syntax as protected trivia", () => {
    const document = createDocument("job /example/test(x)\n  // keep   nearby comment spacing  \n  value1  ,value2  ->out2  \nend");
    const model = buildFormattingInput(document);

    expect(model.lines[1].protectedRanges).to.deep.equal([{ startCharacter: 0, endCharacter: 36 }]);
    expect(model.lines[1].safeToFormat).to.equal(true);
  });

  it("marks blank-line-separated comment groups near malformed recovery syntax as protected trivia", () => {
    const document = createDocument("job /example/test(x)\n   \n  // keep   nearby comment spacing  \n  value1  ,value2  ->out2  \nend");
    const model = buildFormattingInput(document);

    expect(model.lines[1].protectedRanges).to.deep.equal([{ startCharacter: 0, endCharacter: 3 }]);
    expect(model.lines[2].protectedRanges).to.deep.equal([{ startCharacter: 0, endCharacter: 36 }]);
    expect(model.lines[1].safeToFormat).to.equal(true);
    expect(model.lines[2].safeToFormat).to.equal(true);
  });

  it("does not mark isolated blank lines near malformed recovery syntax as protected trivia", () => {
    const document = createDocument("job /example/test(x)\n   \n  value1  ,value2  ->out2  \nend");
    const model = buildFormattingInput(document);

    expect(model.lines[1].protectedRanges).to.deep.equal([]);
    expect(model.lines[1].safeToFormat).to.equal(true);
  });

  it("does not attach comment groups across a non-trivia separator in recovery mode", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  ->out2  \n  helper  ,value2  ->out3  \n   \n  // keep   distant comment spacing  \nend");
    const model = buildFormattingInput(document);

    expect(model.lines[3].protectedRanges).to.deep.equal([]);
    expect(model.lines[4].protectedRanges).to.deep.equal([]);
    expect(model.lines[3].safeToFormat).to.equal(false);
    expect(model.lines[4].safeToFormat).to.equal(false);
  });

  it("marks closing-brace-separated comment groups near malformed recovery syntax as protected trivia", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  -> {\n  }  \n  // keep   nearby comment spacing  \nend");
    const model = buildFormattingInput(document);

    expect(model.lines[2].protectedRanges).to.deep.equal([{ startCharacter: 0, endCharacter: 5 }]);
    expect(model.lines[3].protectedRanges).to.deep.equal([{ startCharacter: 0, endCharacter: 36 }]);
    expect(model.lines[2].safeToFormat).to.equal(true);
    expect(model.lines[3].safeToFormat).to.equal(true);
  });

  it("preserves attached block comments on malformed recovery lines", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  ->out2  /* keep  , -> spacing */\nend");
    const model = buildFormattingInput(document);
    const decisions = planFormatting(model, { startLine: 1, endLine: 1 });

    expect(model.lines[1].protectedRanges).to.deep.equal([
      { startCharacter: 2, endCharacter: 8 },
      { startCharacter: 25, endCharacter: 51 },
    ]);
    expect(decisions[0].formattedText).to.equal("  value1, value2 -> out2  /* keep  , -> spacing */");
  });

  it("formats around ambiguous recovery tokens without preserving separator whitespace", () => {
    const document = createDocument("job /example/test(a,b)\n  value1  ,value2  ->out2  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(a, b)",
        "  value1, value2 -> out2",
        "end",
      ].join("\n")
    );
  });

  it("keeps attached inline comments untouched while formatting the safe recovery prefix", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  ->out2  // keep   comment spacing\nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "  value1, value2 -> out2  // keep   comment spacing",
        "end",
      ].join("\n")
    );
  });

  it("keeps adjacent standalone comment lines untouched while formatting malformed recovery syntax", () => {
    const document = createDocument("job /example/test(x)\n  // keep   nearby comment spacing  \n  value1  ,value2  ->out2  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "  // keep   nearby comment spacing  ",
        "  value1, value2 -> out2",
        "end",
      ].join("\n")
    );
  });

  it("keeps blank-line-separated comment groups untouched while formatting malformed recovery syntax", () => {
    const document = createDocument("job /example/test(x)\n   \n  // keep   nearby comment spacing  \n  value1  ,value2  ->out2  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "   ",
        "  // keep   nearby comment spacing  ",
        "  value1, value2 -> out2",
        "end",
      ].join("\n")
    );
  });

  it("normalizes isolated blank lines while formatting malformed recovery syntax", () => {
    const document = createDocument("job /example/test(x)\n   \n  value1  ,value2  ->out2  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "",
        "  value1, value2 -> out2",
        "end",
      ].join("\n")
    );
  });

  it("keeps non-trivia separators as the hard stop for recovery comment ownership", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  ->out2  \n  helper  ,value2  ->out3  \n   \n  // keep   distant comment spacing  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "  value1, value2 -> out2",
        "  helper, value2 -> out3",
        "   ",
        "  // keep   distant comment spacing  ",
        "end",
      ].join("\n")
    );
  });

  it("keeps closing-brace-separated comment groups untouched while formatting malformed recovery syntax", () => {
    const document = createDocument("job /example/test(x)\n  value1  ,value2  -> {\n  }  \n  // keep   nearby comment spacing  \nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "  value1, value2 -> {",
        "  }  ",
        "  // keep   nearby comment spacing  ",
        "end",
      ].join("\n")
    );
  });

  it("formats recovery lines with attached inline comments correctly under CRLF line endings", () => {
    const document = createDocument("job /example/test(x)\r\n  value1  ,value2  ->out2  // keep   comment spacing\r\nend");
    const output = TextDocument.applyEdits(document, formatDocument(document)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x)",
        "  value1, value2 -> out2  // keep   comment spacing",
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
        "  value1, value2 -> out2",
        "end",
      ].join("\n")
    );
  });
});
