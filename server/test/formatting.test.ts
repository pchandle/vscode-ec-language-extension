/// <reference path="./globals.d.ts" />
import { expect } from "chai";
import { Position, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildFormattingInput, formatDocument, formatDocumentRange, planFormatting } from "../src/formatting";
import { normalizeRangeToTouchedLines } from "../src/formattingRange";

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

  it("keeps multiline def header targets and comment-separated continuation lines inside the parsed formatter input model", () => {
    const input = createDocument(
      [
        "def helper(",
        "x,",
        "y) out1,",
        "// keep target note",
        "out2:",
        "$ -> value",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);
    const def = model.program.statements[0] as any;

    expect(model.parseMode).to.equal("parsed");
    expect(def.targets.map((target: any) => target.lexeme)).to.deep.equal(["out1", "out2"]);
    expect(def.body.range.start.line).to.equal(5);
    expect(model.lines[3].desiredIndentColumns).to.equal(2);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
    expect(model.lines[5].desiredIndentColumns).to.equal(2);
  });

  it("keeps newline-start def header targets and comment-separated continuation lines inside the parsed formatter input model", () => {
    const input = createDocument(
      [
        "def helper(",
        "x,",
        "y)",
        "// keep target note",
        "out1,",
        "out2:",
        "$ -> value",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);
    const def = model.program.statements[0] as any;

    expect(model.parseMode).to.equal("parsed");
    expect(def.targets.map((target: any) => target.lexeme)).to.deep.equal(["out1", "out2"]);
    expect(def.body.range.start.line).to.equal(6);
    expect(model.lines[3].desiredIndentColumns).to.equal(2);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
    expect(model.lines[5].desiredIndentColumns).to.equal(2);
    expect(model.lines[6].desiredIndentColumns).to.equal(2);
  });

  it("marks extra blank lines inside parsed block bodies for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(x):",
        "  value -> {",
        "",
        "",
        "    // keep note",
        "    sub /data/new($)->out",
        "  }",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[2].deleteLine).to.equal(true);
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].desiredIndentColumns).to.equal(4);
  });

  it("marks extra blank lines after parsed if end-target continuations for deletion", () => {
    const input = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "end -> result1,",
        "",
        "",
        "  result2",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[3].deleteLine).to.equal(false);
    expect(model.lines[4].deleteLine).to.equal(true);
    expect(model.lines[5].desiredIndentColumns).to.equal(2);
  });

  it("marks extra blank lines before parsed bare if end delimiters for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(x):",
        "  if ready then",
        "    sub /data/new($)->out",
        "",
        "",
        "  end",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[3].deleteLine).to.equal(false);
    expect(model.lines[4].deleteLine).to.equal(true);
    expect(model.lines[5].desiredIndentColumns).to.equal(2);
  });

  it("marks blank lines between a standalone comment group and parsed else or bare end delimiters for deletion", () => {
    const input = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "  // keep else note",
        "",
        "",
        "else",
        "  $ -> fallback",
        "  // keep end note",
        "",
        "",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].deleteLine).to.equal(true);
    expect(model.lines[8].deleteLine).to.equal(true);
    expect(model.lines[9].deleteLine).to.equal(true);
  });

  it("marks blank lines between a standalone comment group and a parsed end-arrow delimiter for deletion", () => {
    const input = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "  // keep target note",
        "",
        "",
        "end -> result1,",
        "  result2",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].deleteLine).to.equal(true);
  });

  it("marks extra blank lines inside parsed multiline if header continuation regions for deletion", () => {
    const input = createDocument(
      [
        "if ready &&",
        "",
        "",
        "available",
        "then",
        "  sub /data/new($)->out",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[1].deleteLine).to.equal(false);
    expect(model.lines[2].deleteLine).to.equal(true);
    expect(model.lines[3].desiredIndentColumns).to.equal(2);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
  });

  it("marks extra blank lines inside parsed multiline job and def header continuation regions for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(",
        "x,",
        "",
        "",
        "y) out1,",
        "out2:",
        "  sub /data/new($)->out",
        "end",
        "",
        "def helper(",
        "x,",
        "",
        "",
        "y) out1,",
        "out2:",
        "  $ -> value",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[2].deleteLine).to.equal(false);
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[11].deleteLine).to.equal(false);
    expect(model.lines[12].deleteLine).to.equal(true);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
    expect(model.lines[13].desiredIndentColumns).to.equal(2);
  });

  it("marks extra blank lines inside parsed multiline defaults continuation regions for deletion", () => {
    const input = createDocument(
      [
        "defaults: data,",
        "default,",
        "",
        "",
        "x64,",
        "codevalley",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[2].deleteLine).to.equal(false);
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
    expect(model.lines[5].desiredIndentColumns).to.equal(2);
  });

  it("marks extra blank lines inside parsed multiline invocation continuation regions for deletion", () => {
    const input = createDocument(
      [
        "sub /data/new(",
        "$,",
        "",
        "",
        "1) -> out1,",
        "out2",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[2].deleteLine).to.equal(false);
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
    expect(model.lines[5].desiredIndentColumns).to.equal(2);
  });

  it("marks extra blank lines inside parsed multiline additional-output continuation regions for deletion", () => {
    const input = createDocument(
      [
        "value -> first,",
        "",
        "",
        "second,",
        "{",
        "1 -> inner",
        "},",
        "",
        "",
        "third",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[1].deleteLine).to.equal(false);
    expect(model.lines[2].deleteLine).to.equal(true);
    expect(model.lines[7].deleteLine).to.equal(false);
    expect(model.lines[8].deleteLine).to.equal(true);
    expect(model.lines[3].desiredIndentColumns).to.equal(2);
    expect(model.lines[4].desiredIndentColumns).to.equal(2);
    expect(model.lines[9].desiredIndentColumns).to.equal(2);
  });

  it("marks blank lines between a standalone comment group and parsed declaration end delimiters for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(x):",
        "  $ -> value",
        "  // keep end note",
        "",
        "",
        "end",
        "",
        "def helper(x) out:",
        "  $ -> value",
        "  // keep end note",
        "",
        "",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].deleteLine).to.equal(true);
    expect(model.lines[10].deleteLine).to.equal(true);
    expect(model.lines[11].deleteLine).to.equal(true);
  });

  it("marks blank lines between a standalone comment group and parsed brace-block close delimiters for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(x):",
        "  value -> {",
        "    sub /data/new($) -> out",
        "    // keep close note",
        "",
        "",
        "  }",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[4].deleteLine).to.equal(true);
    expect(model.lines[5].deleteLine).to.equal(true);
  });

  it("marks blank lines between parsed brace-block open delimiters and a following standalone comment group for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(x):",
        "  value -> {",
        "",
        "",
        "    // keep open note",
        "    sub /data/new($) -> out",
        "  }",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[2].deleteLine).to.equal(true);
    expect(model.lines[3].deleteLine).to.equal(true);
  });

  it("marks blank lines between parsed declaration headers and a following standalone comment group for deletion", () => {
    const input = createDocument(
      [
        "job /example/test(x):",
        "",
        "",
        "  // keep body note",
        "  $ -> value",
        "end",
        "",
        "def helper(",
        "x,",
        "y) out:",
        "",
        "",
        "  // keep body note",
        "  $ -> value",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[1].deleteLine).to.equal(true);
    expect(model.lines[2].deleteLine).to.equal(true);
    expect(model.lines[10].deleteLine).to.equal(true);
    expect(model.lines[11].deleteLine).to.equal(true);
  });

  it("marks blank lines between parsed if branch boundaries and a following standalone comment group for deletion", () => {
    const input = createDocument(
      [
        "if ready then",
        "",
        "",
        "  // keep then note",
        "  sub /data/new($) -> out",
        "else",
        "",
        "",
        "  // keep else note",
        "  $ -> fallback",
        "end",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[1].deleteLine).to.equal(true);
    expect(model.lines[2].deleteLine).to.equal(true);
    expect(model.lines[6].deleteLine).to.equal(true);
    expect(model.lines[7].deleteLine).to.equal(true);
  });

  it("marks blank lines between parsed end-arrow boundaries and a following standalone comment group for deletion", () => {
    const input = createDocument(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "end -> result1,",
        "",
        "",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[3].deleteLine).to.equal(true);
    expect(model.lines[4].deleteLine).to.equal(true);
  });

  it("marks blank lines between parsed defaults boundaries and a following standalone comment group for deletion", () => {
    const input = createDocument(
      [
        "defaults: data,",
        "",
        "",
        "  // keep defaults note",
        "  x64,",
        "  codevalley",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[1].deleteLine).to.equal(true);
    expect(model.lines[2].deleteLine).to.equal(true);
  });

  it("marks blank lines between parsed invocation boundaries and a following standalone comment group for deletion", () => {
    const input = createDocument(
      [
        "sub /data/new(",
        "",
        "",
        "  // keep arg note",
        "  $,",
        "  1) -> out",
      ].join("\n")
    );
    const model = buildFormattingInput(input);

    expect(model.parseMode).to.equal("parsed");
    expect(model.lines[1].deleteLine).to.equal(true);
    expect(model.lines[2].deleteLine).to.equal(true);
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
        "  // keep   comment spacing",
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

  it("canonically indents parsed if/else blocks and aligns their delimiters", () => {
    const input = [
      "job /example/test(x):",
      "  if ready then",
      "// keep   comment spacing",
      "sub /data/new($)->out",
      "  else",
      "$  ->fallback",
      " end -> result",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  if ready then",
        "    // keep   comment spacing",
        "    sub /data/new($) -> out",
        "  else",
        "    $ -> fallback",
        "  end -> result",
        "end",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed explicit block bodies", () => {
    const input = [
      "job /example/test(x):",
      "",
      "",
      "  // keep body note",
      "  $  ->value",
      "end",
      "",
      "if ready then",
      "",
      "",
      "  // keep then note",
      "  sub /data/new($)->out",
      "end",
      "",
      "value -> {",
      "",
      "",
      "  // keep block note",
      "  sub /data/new($)->out",
      "}",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  // keep body note",
        "  $ -> value",
        "end",
        "",
        "if ready then",
        "  // keep then note",
        "  sub /data/new($) -> out",
        "end",
        "",
        "value -> {",
        "  // keep block note",
        "  sub /data/new($) -> out",
        "}",
      ].join("\n")
    );
  });

  it("collapses blank lines between parsed if branch boundaries and following standalone comment groups", () => {
    const input = [
      "if ready then",
      "",
      "",
      "  // keep then note",
      "  sub /data/new($) -> out",
      "else",
      "",
      "",
      "  // keep else note",
      "  $ -> fallback",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready then",
        "  // keep then note",
        "  sub /data/new($) -> out",
        "else",
        "  // keep else note",
        "  $ -> fallback",
        "end",
      ].join("\n")
    );
  });

  it("collapses blank lines between parsed declaration headers and following standalone comment groups", () => {
    const input = [
      "job /example/test(x):",
      "",
      "",
      "  // keep body note",
      "  $ -> value",
      "end",
      "",
      "def helper(",
      "x,",
      "y) out:",
      "",
      "",
      "  // keep body note",
      "  $ -> value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  // keep body note",
        "  $ -> value",
        "end",
        "",
        "def helper(",
        "  x,",
        "  y) out:",
        "  // keep body note",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed if end-target continuation regions", () => {
    const input = [
      "if ready then",
      "  sub /data/new($)->out",
      "",
      "",
      "end -> result1,",
      "",
      "",
      "  // keep target note",
      "  result2",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("collapses blank lines between parsed end-arrow boundaries and following standalone comment groups", () => {
    const input = [
      "if ready then",
      "  sub /data/new($) -> out",
      "end -> result1,",
      "",
      "",
      "  // keep target note",
      "  result2",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("canonically indents parsed if blocks with bare end delimiters and collapses adjacent blank lines", () => {
    const input = [
      "job /example/test(x):",
      "  if ready then",
      "    sub /data/new($)->out",
      "",
      "",
      "    // keep note",
      "  end",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  if ready then",
        "    sub /data/new($) -> out",
        "",
        "    // keep note",
        "  end",
        "end",
      ].join("\n")
    );
  });

  it("collapses blank lines between standalone comment groups and parsed else or bare end delimiters", () => {
    const input = [
      "if ready then",
      "  sub /data/new($)->out",
      "  // keep else note",
      "",
      "",
      "else",
      "  $  ->fallback",
      "  // keep end note",
      "",
      "",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "  // keep else note",
        "else",
        "  $ -> fallback",
        "  // keep end note",
        "end",
      ].join("\n")
    );
  });

  it("collapses blank lines between standalone comment groups and parsed end-arrow delimiters", () => {
    const input = [
      "if ready then",
      "  sub /data/new($)->out",
      "  // keep target note",
      "",
      "",
      "end -> result1,",
      "  result2",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "  // keep target note",
        "end -> result1,",
        "  result2",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed multiline if header continuation regions", () => {
    const input = [
      "if ready &&",
      "",
      "",
      "available",
      "then",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready &&",
        "",
        "  available",
        "  then",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed multiline job and def header continuation regions", () => {
    const input = [
      "job /example/test(",
      "x,",
      "",
      "",
      "y) out1,",
      "out2:",
      "  sub /data/new($)->out",
      "end",
      "",
      "def helper(",
      "x,",
      "",
      "",
      "y) out1,",
      "out2:",
      "  $ -> value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(",
        "  x,",
        "",
        "  y) out1,",
        "  out2:",
        "  sub /data/new($) -> out",
        "end",
        "",
        "def helper(",
        "  x,",
        "",
        "  y) out1,",
        "  out2:",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed multiline defaults continuation regions", () => {
    const input = [
      "defaults: data,",
      "default,",
      "",
      "",
      "x64,",
      "codevalley",
      "sub /data/new($)->out",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "defaults: data,",
        "  default,",
        "",
        "  x64,",
        "  codevalley",
        "sub /data/new($) -> out",
      ].join("\n")
    );
  });

  it("collapses blank lines between parsed defaults boundaries and following standalone comment groups", () => {
    const input = [
      "defaults: data,",
      "",
      "",
      "  // keep defaults note",
      "  x64,",
      "  codevalley",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "defaults: data,",
        "  // keep defaults note",
        "  x64,",
        "  codevalley",
      ].join("\n")
    );
  });

  it("collapses blank lines between parsed invocation boundaries and following standalone comment groups", () => {
    const input = [
      "sub /data/new(",
      "",
      "",
      "  // keep arg note",
      "  $,",
      "  1) -> out",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "sub /data/new(",
        "  // keep arg note",
        "  $,",
        "  1) -> out",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed multiline invocation continuation regions", () => {
    const input = [
      "job /example/test(x):",
      "sub /data/new(",
      "$,",
      "",
      "",
      "1) -> out1,",
      "out2",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  sub /data/new(",
        "    $,",
        "",
        "    1) -> out1,",
        "    out2",
        "end",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines inside parsed multiline additional-output continuation regions", () => {
    const input = [
      "value -> first,",
      "",
      "",
      "second,",
      "{",
      "1 -> inner",
      "},",
      "",
      "",
      "third",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "value -> first,",
        "",
        "  second,",
        "  {",
        "  1 -> inner",
        "},",
        "",
        "  third",
      ].join("\n")
    );
  });

  it("collapses blank lines between standalone comment groups and parsed declaration end delimiters", () => {
    const input = [
      "job /example/test(x):",
      "  $ -> value",
      "  // keep end note",
      "",
      "",
      "end",
      "",
      "def helper(x) out:",
      "  $ -> value",
      "  // keep end note",
      "",
      "",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  $ -> value",
        "  // keep end note",
        "end",
        "",
        "def helper(x) out:",
        "  $ -> value",
        "  // keep end note",
        "end",
      ].join("\n")
    );
  });

  it("collapses blank lines between standalone comment groups and parsed brace-block close delimiters", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "    sub /data/new($) -> out",
      "    // keep close note",
      "",
      "",
      "  }",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    sub /data/new($) -> out",
        "    // keep close note",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("collapses blank lines between parsed brace-block open delimiters and following standalone comment groups", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "",
      "",
      "    // keep open note",
      "    sub /data/new($) -> out",
      "  }",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    // keep open note",
        "    sub /data/new($) -> out",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents parsed multiline if headers and trailing end targets", () => {
    const input = [
      "job /example/test(x):",
      "if ready &&",
      "available",
      "then",
      "sub /data/new($)->out",
      "else",
      "$  ->fallback",
      "end -> result1,",
      "result2",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  if ready &&",
        "    available",
        "    then",
        "    sub /data/new($) -> out",
        "  else",
        "    $ -> fallback",
        "  end -> result1,",
        "    result2",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents parsed multiline defaults continuations", () => {
    const input = [
      "defaults: data,",
      "default,",
      "x64,",
      "codevalley",
      "sub /data/new($)->out",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "defaults: data,",
        "  default,",
        "  x64,",
        "  codevalley",
        "sub /data/new($) -> out",
      ].join("\n")
    );
  });

  it("canonically indents standalone comments attached to parsed multiline defaults continuations", () => {
    const input = [
      "defaults: data,",
      "// keep defaults note",
      "default,",
      "x64,",
      "// keep platform note",
      "codevalley",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "defaults: data,",
        "  // keep defaults note",
        "  default,",
        "  x64,",
        "  // keep platform note",
        "  codevalley",
      ].join("\n")
    );
  });

  it("canonically indents standalone comments attached to parsed multiline if headers and trailing end targets", () => {
    const input = [
      "if ready &&",
      "// keep condition note",
      "available",
      "then",
      "sub /data/new($)->out",
      "end -> result1,",
      "// keep target note",
      "result2",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "if ready &&",
        "  // keep condition note",
        "  available",
        "  then",
        "  sub /data/new($) -> out",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("canonically indents parsed multiline output-target continuations for additional statement forms", () => {
    const input = [
      "value -> first,",
      "second",
      "other_value -> first,",
      "{",
      "1 -> inner",
      "},",
      "third",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "value -> first,",
        "  second",
        "other_value -> first,",
        "  {",
        "  1 -> inner",
        "},",
        "  third",
      ].join("\n")
    );
  });

  it("canonically indents parsed output targets whose first target starts after newline arrow", () => {
    const input = [
      "sub /data/new($) ->",
      "out1,",
      "out2",
      "value ->",
      "first,",
      "{",
      "1 -> inner",
      "},",
      "third",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "sub /data/new($) ->",
        "  out1,",
        "  out2",
        "value ->",
        "  first,",
        "  {",
        "  1 -> inner",
        "},",
        "  third",
      ].join("\n")
    );
  });

  it("canonically indents parsed braced obligations whose first block starts after newline arrow", () => {
    const input = [
      "sub /data/new($) ->",
      "{",
      "1 -> inner",
      "}",
      "value ->",
      "{",
      "1 -> inner",
      "},",
      "third",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "sub /data/new($) ->",
        "  {",
        "  1 -> inner",
        "}",
        "value ->",
        "  {",
        "  1 -> inner",
        "},",
        "  third",
      ].join("\n")
    );
  });

  it("canonically indents standalone comments attached to parsed multiline target and obligation continuations", () => {
    const input = [
      "value -> first,",
      "// keep target note",
      "second",
      "other_value -> first,",
      "{",
      "1 -> inner",
      "},",
      "// keep trailing target note",
      "third",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "value -> first,",
        "  // keep target note",
        "  second",
        "other_value -> first,",
        "  {",
        "  1 -> inner",
        "},",
        "  // keep trailing target note",
        "  third",
      ].join("\n")
    );
  });

  it("canonically indents parsed job and def bodies and aligns closing end lines", () => {
    const input = [
      "job /example/test(x):",
      "// keep   comment spacing",
      "sub /data/new($)->out",
      " end",
      "",
      "def helper(x):",
      "$  ->value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  // keep   comment spacing",
        "  sub /data/new($) -> out",
        "end",
        "",
        "def helper(x):",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("reindents standalone multiline block comments inside parsed structural regions while preserving inner relative spacing", () => {
    const input = [
      "job /example/test(x):",
      "/* keep  , -> spacing",
      "   and indentation */",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  /* keep  , -> spacing",
        "     and indentation */",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents parsed multiline job and def headers", () => {
    const input = [
      "job /example/test(",
      "x,",
      "y) out1,",
      "out2",
      ":",
      "1 -> out1",
      "end",
      "",
      "def helper(",
      "x,",
      "y):",
      "$  ->value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(",
        "  x,",
        "  y) out1,",
        "  out2",
        "  :",
        "  1 -> out1",
        "end",
        "",
        "def helper(",
        "  x,",
        "  y):",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents standalone comments attached to parsed multiline job and def headers", () => {
    const input = [
      "job /example/test(",
      "// keep param note",
      "x,",
      "y) out1,",
      "// keep target note",
      "out2",
      ":",
      "1 -> out1",
      "end",
      "",
      "def helper(",
      "// keep helper note",
      "x,",
      "y):",
      "$  ->value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(",
        "  // keep param note",
        "  x,",
        "  y) out1,",
        "  // keep target note",
        "  out2",
        "  :",
        "  1 -> out1",
        "end",
        "",
        "def helper(",
        "  // keep helper note",
        "  x,",
        "  y):",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("keeps low-disruption formatting for parsed multiline def header targets separated by standalone comment lines", () => {
    const input = [
      "def helper(",
      "x,",
      "y) out1,",
      "// keep target note",
      "out2:",
      "$  ->value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "def helper(",
        "  x,",
        "  y) out1,",
        "  // keep target note",
        "  out2:",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("keeps low-disruption formatting for parsed def header targets that start on the next line after ')'", () => {
    const input = [
      "def helper(",
      "x,",
      "y)",
      "// keep target note",
      "out1,",
      "out2:",
      "$  ->value",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "def helper(",
        "  x,",
        "  y)",
        "  // keep target note",
        "  out1,",
        "  out2:",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents parsed multiline invocation continuations for sub host and join", () => {
    const input = [
      "job /example/test(x):",
      "sub /data/new(",
      "$,",
      "1,",
      "2) -> out1,",
      "out2",
      "host /example/protocol(",
      "$,",
      "signal) -> host_out",
      "join /example/protocol(",
      "$,",
      "signal) -> join_out1,",
      "join_out2",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  sub /data/new(",
        "    $,",
        "    1,",
        "    2) -> out1,",
        "    out2",
        "  host /example/protocol(",
        "    $,",
        "    signal) -> host_out",
        "  join /example/protocol(",
        "    $,",
        "    signal) -> join_out1,",
        "    join_out2",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents parsed multiline invocation continuations that carry braced obligations", () => {
    const input = [
      "job /example/test(x):",
      "sub /data/new(",
      "$,",
      "1) -> {",
      "$  -> inner",
      "}",
      "join /example/protocol(",
      "$,",
      "signal) -> first,",
      "{",
      "$  -> second",
      "},",
      "third",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  sub /data/new(",
        "    $,",
        "    1) -> {",
        "    $ -> inner",
        "  }",
        "  join /example/protocol(",
        "    $,",
        "    signal) -> first,",
        "    {",
        "    $ -> second",
        "  },",
        "    third",
        "end",
      ].join("\n")
    );
  });

  it("canonically indents standalone comments attached to parsed multiline invocation continuations", () => {
    const input = [
      "job /example/test(x):",
      "sub /data/new(",
      "// keep arg note",
      "$,",
      "1) ->",
      "// keep target note",
      "out1,",
      "out2",
      "join /example/protocol(",
      "// keep join arg note",
      "$,",
      "signal) -> {",
      "// keep obligation note",
      "$  -> second",
      "}",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  sub /data/new(",
        "    // keep arg note",
        "    $,",
        "    1) ->",
        "    // keep target note",
        "    out1,",
        "    out2",
        "  join /example/protocol(",
        "    // keep join arg note",
        "    $,",
        "    signal) -> {",
        "    // keep obligation note",
        "    $ -> second",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("returns no edits for already formatted input", () => {
    const input = [
      "job /example/test(a, b):",
      "  value1, value2 -> out2",
      "  // keep   comment spacing",
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

  it("collapses excessive blank lines only inside the selected portion of a parsed block body", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "",
      "",
      "  // keep block note",
      "sub /data/new($)->out",
      "}",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 2, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    // keep block note",
        "    sub /data/new($) -> out",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("collapses excessive blank lines around parsed if end boundaries only when the selected slice fully covers them", () => {
    const input = [
      "if ready then",
      "  sub /data/new($)->out",
      "",
      "",
      "end -> result1,",
      "",
      "",
      "  // keep target note",
      "  result2",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 8)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("formats selected parsed if blocks with bare end delimiters and adjacent blank lines", () => {
    const input = [
      "job /example/test(x):",
      "  if ready then",
      "    sub /data/new($)->out",
      "",
      "",
      "    // keep note",
      "  end",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  if ready then",
        "    sub /data/new($) -> out",
        "",
        "    // keep note",
        "  end",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed if blocks with comment-attached else and bare end delimiters", () => {
    const input = [
      "if ready then",
      "  sub /data/new($)->out",
      "  // keep else note",
      "",
      "",
      "else",
      "  $  ->fallback",
      "  // keep end note",
      "",
      "",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 10)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "  // keep else note",
        "else",
        "  $ -> fallback",
        "  // keep end note",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed if blocks with comment-attached end-arrow delimiters", () => {
    const input = [
      "if ready then",
      "  sub /data/new($)->out",
      "  // keep target note",
      "",
      "",
      "end -> result1,",
      "  result2",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "  // keep target note",
        "end -> result1,",
        "  result2",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline if headers with collapsed blank-line runs", () => {
    const input = [
      "if ready &&",
      "",
      "",
      "available",
      "then",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready &&",
        "",
        "  available",
        "  then",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline job and def headers with collapsed blank-line runs", () => {
    const input = [
      "job /example/test(",
      "x,",
      "",
      "",
      "y) out1,",
      "out2:",
      "  sub /data/new($)->out",
      "end",
      "",
      "def helper(",
      "x,",
      "",
      "",
      "y) out1,",
      "out2:",
      "  $ -> value",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 15)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(",
        "  x,",
        "",
        "  y) out1,",
        "  out2:",
        "  sub /data/new($) -> out",
        "end",
        "",
        "def helper(",
        "  x,",
        "",
        "  y) out1,",
        "  out2:",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline defaults continuations with collapsed blank-line runs", () => {
    const input = [
      "defaults: data,",
      "default,",
      "",
      "",
      "x64,",
      "codevalley",
      "sub /data/new($)->out",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "defaults: data,",
        "  default,",
        "",
        "  x64,",
        "  codevalley",
        "sub /data/new($)->out",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline defaults continuations with comment-attached boundaries", () => {
    const input = [
      "defaults: data,",
      "",
      "",
      "  // keep defaults note",
      "  x64,",
      "  codevalley",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "defaults: data,",
        "  // keep defaults note",
        "  x64,",
        "  codevalley",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline invocation continuations with comment-attached boundaries", () => {
    const input = [
      "sub /data/new(",
      "",
      "",
      "  // keep arg note",
      "  $,",
      "  1) -> out",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "sub /data/new(",
        "  // keep arg note",
        "  $,",
        "  1) -> out",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline invocation continuations with collapsed blank-line runs", () => {
    const input = [
      "job /example/test(x):",
      "sub /data/new(",
      "$,",
      "",
      "",
      "1) -> out1,",
      "out2",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  sub /data/new(",
        "    $,",
        "",
        "    1) -> out1,",
        "    out2",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline additional-output continuations with collapsed blank-line runs", () => {
    const input = [
      "value -> first,",
      "",
      "",
      "second,",
      "{",
      "1 -> inner",
      "},",
      "",
      "",
      "third",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 9)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "value -> first,",
        "",
        "  second,",
        "  {",
        "  1 -> inner",
        "},",
        "",
        "  third",
      ].join("\n")
    );
  });

  it("formats selected parsed declaration bodies with comment-attached end delimiters", () => {
    const input = [
      "job /example/test(x):",
      "  $ -> value",
      "  // keep end note",
      "",
      "",
      "end",
      "",
      "def helper(x) out:",
      "  $ -> value",
      "  // keep end note",
      "",
      "",
      "end",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  $ -> value",
        "  // keep end note",
        "end",
        "",
        "def helper(x) out:",
        "  $ -> value",
        "  // keep end note",
        "",
        "",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed brace blocks with comment-attached close delimiters", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "    sub /data/new($) -> out",
      "    // keep close note",
      "",
      "",
      "  }",
      "end",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 2, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    sub /data/new($) -> out",
        "    // keep close note",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed brace blocks with comment-attached open delimiters", () => {
    const input = [
      "job /example/test(x):",
      "  value -> {",
      "",
      "",
      "    // keep open note",
      "    sub /data/new($) -> out",
      "  }",
      "end",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  value -> {",
        "    // keep open note",
        "    sub /data/new($) -> out",
        "  }",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed declaration bodies with comment-attached header boundaries", () => {
    const input = [
      "job /example/test(x):",
      "",
      "",
      "  // keep body note",
      "  $ -> value",
      "end",
      "",
      "def helper(",
      "x,",
      "y) out:",
      "",
      "",
      "  // keep body note",
      "  $ -> value",
      "end",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  // keep body note",
        "  $ -> value",
        "end",
        "",
        "def helper(",
        "x,",
        "y) out:",
        "",
        "",
        "  // keep body note",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed if branches with comment-attached branch boundaries", () => {
    const input = [
      "if ready then",
      "",
      "",
      "  // keep then note",
      "  sub /data/new($) -> out",
      "else",
      "",
      "",
      "  // keep else note",
      "  $ -> fallback",
      "end",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 0, 9)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready then",
        "  // keep then note",
        "  sub /data/new($) -> out",
        "else",
        "  // keep else note",
        "  $ -> fallback",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed end-arrow continuations with comment-attached boundaries", () => {
    const input = [
      "if ready then",
      "  sub /data/new($) -> out",
      "end -> result1,",
      "",
      "",
      "  // keep target note",
      "  result2",
    ].join("\n");
    const document = createDocument(input);

    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 2, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("formats the selected portion of a parsed if block using structural indentation", () => {
    const input = [
      "job /example/test(x):",
      "  if ready then",
      "sub /data/new($)->out",
      " else",
      "$  ->fallback",
      "end -> result",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 2, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  if ready then",
        "    sub /data/new($) -> out",
        "  else",
        "    $ -> fallback",
        "  end -> result",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline if headers and trailing end targets", () => {
    const input = [
      "if ready &&",
      "available",
      "then",
      "sub /data/new($)->out",
      "end -> result1,",
      "result2",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready &&",
        "  available",
        "  then",
        "  sub /data/new($) -> out",
        "end -> result1,",
        "  result2",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline defaults continuations", () => {
    const input = [
      "defaults: data,",
      "default,",
      "x64,",
      "codevalley",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 3)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "defaults: data,",
        "  default,",
        "  x64,",
        "  codevalley",
      ].join("\n")
    );
  });

  it("formats a selected first else-body content line together with the else delimiter prefix", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out",
      "else",
      "// keep fallback note",
      "$  ->fallback",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(4, 1), Position.create(4, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 2,
      endLine: 4,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "sub /data/new($)->out",
        "else",
        "  // keep fallback note",
        "  $ -> fallback",
        "end",
      ].join("\n")
    );
  });

  it("keeps a selected later else-body content line line-bounded", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out",
      "else",
      "$ -> fallback1",
      "$  ->fallback2",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(4, 1), Position.create(4, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 4,
      endLine: 4,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "sub /data/new($)->out",
        "else",
        "$ -> fallback1",
        "  $ -> fallback2",
        "end",
      ].join("\n")
    );
  });

  it("formats a selected first then-body content line together with a same-line then boundary", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(1, 1), Position.create(1, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 0,
      endLine: 1,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("formats a selected first then-body content line together with a standalone then boundary", () => {
    const input = [
      "if ready &&",
      "available",
      "then",
      "// keep then note",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(4, 1), Position.create(4, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 2,
      endLine: 4,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready &&",
        "available",
        "  then",
        "  // keep then note",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("keeps a selected later then-body content line line-bounded", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out1",
      "sub /data/new($)->out2",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(2, 1), Position.create(2, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 2,
      endLine: 2,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "sub /data/new($)->out1",
        "  sub /data/new($) -> out2",
        "end",
      ].join("\n")
    );
  });

  it("formats a selected multiline if-header content line together with the standalone then suffix", () => {
    const input = [
      "if ready &&",
      "available",
      "// keep condition note",
      "then",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(1, 1), Position.create(1, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 1,
      endLine: 3,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready &&",
        "  available",
        "  // keep condition note",
        "  then",
        "sub /data/new($)->out",
        "end",
      ].join("\n")
    );
  });

  it("formats a selected standalone then line together with its immediate header suffix", () => {
    const input = [
      "if ready &&",
      "available",
      "// keep condition note",
      "then",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(3, 1), Position.create(3, 4)));
    expect(normalizedRange).to.deep.equal({
      startLine: 1,
      endLine: 3,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready &&",
        "  available",
        "  // keep condition note",
        "  then",
        "sub /data/new($)->out",
        "end",
      ].join("\n")
    );
  });

  it("keeps an inner else-body selection anchored to the inner slice instead of cascading to the enclosing if", () => {
    const input = [
      "if outer then",
      "  if inner then",
      "    sub /data/new($)->out",
      "  else",
      "    $  ->fallback",
      "  end",
      "else",
      "  $ -> outerFallback",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(4, 1), Position.create(4, 5)));
    expect(normalizedRange).to.deep.equal({
      startLine: 3,
      endLine: 4,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if outer then",
        "  if inner then",
        "    sub /data/new($)->out",
        "  else",
        "    $ -> fallback",
        "  end",
        "else",
        "  $ -> outerFallback",
        "end",
      ].join("\n")
    );
  });

  it("keeps an inner end-arrow delimiter selection anchored to the inner slice instead of cascading to the enclosing if", () => {
    const input = [
      "if outer then",
      "  if inner then",
      "    sub /data/new($)->out",
      "  end -> inner1,",
      "  // keep target note",
      "  inner2",
      "else",
      "  $ -> outerFallback",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(3, 2), Position.create(3, 8)));
    expect(normalizedRange).to.deep.equal({
      startLine: 3,
      endLine: 5,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if outer then",
        "  if inner then",
        "    sub /data/new($)->out",
        "  end -> inner1,",
        "    // keep target note",
        "    inner2",
        "else",
        "  $ -> outerFallback",
        "end",
      ].join("\n")
    );
  });

  it("formats a selected end-arrow delimiter line together with its immediate continuation prefix", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out",
      "end -> result1,",
      "// keep target note",
      "result2",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(2, 2), Position.create(2, 8)));
    expect(normalizedRange).to.deep.equal({
      startLine: 2,
      endLine: 4,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "sub /data/new($)->out",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("formats a selected first end-arrow continuation content line together with the delimiter prefix", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out",
      "end -> result1,",
      "// keep target note",
      "result2",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(4, 1), Position.create(4, 6)));
    expect(normalizedRange).to.deep.equal({
      startLine: 2,
      endLine: 4,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "sub /data/new($)->out",
        "end -> result1,",
        "  // keep target note",
        "  result2",
        "end",
      ].join("\n")
    );
  });

  it("keeps a selected later end-arrow continuation content line line-bounded", () => {
    const input = [
      "if ready then",
      "sub /data/new($)->out",
      "end -> result1,",
      "// keep target note",
      "result2,",
      "result3",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const normalizedRange = normalizeRangeToTouchedLines(document, Range.create(Position.create(5, 1), Position.create(5, 6)));
    expect(normalizedRange).to.deep.equal({
      startLine: 5,
      endLine: 5,
    });
    const selectedRange = normalizedRange!;
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, selectedRange.startLine, selectedRange.endLine)).replace(
      /\r\n/g,
      "\n"
    );

    expect(output).to.equal(
      [
        "if ready then",
        "sub /data/new($)->out",
        "end -> result1,",
        "// keep target note",
        "result2,",
        "  result3",
        "end",
      ].join("\n")
    );
  });

  it("formats selected standalone comments attached to parsed multiline defaults continuations", () => {
    const input = [
      "defaults: data,",
      "// keep defaults note",
      "default,",
      "x64,",
      "// keep platform note",
      "codevalley",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "defaults: data,",
        "  // keep defaults note",
        "  default,",
        "  x64,",
        "  // keep platform note",
        "  codevalley",
      ].join("\n")
    );
  });

  it("formats selected standalone comments attached to parsed multiline if headers and trailing end targets", () => {
    const input = [
      "if ready &&",
      "// keep condition note",
      "available",
      "then",
      "sub /data/new($)->out",
      "end -> result1,",
      "// keep target note",
      "result2",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 7)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "if ready &&",
        "  // keep condition note",
        "  available",
        "  then",
        "  sub /data/new($) -> out",
        "end -> result1,",
        "  // keep target note",
        "  result2",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline output-target continuations for additional statement forms", () => {
    const input = [
      "value -> first,",
      "second",
      "other_value -> first,",
      "{",
      "1 -> inner",
      "},",
      "third",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 6)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "value -> first,",
        "  second",
        "other_value -> first,",
        "  {",
        "  1 -> inner",
        "},",
        "  third",
      ].join("\n")
    );
  });

  it("formats selected parsed output targets whose first target starts after newline arrow", () => {
    const input = [
      "sub /data/new($) ->",
      "out1,",
      "out2",
      "value ->",
      "first,",
      "{",
      "1 -> inner",
      "},",
      "third",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 8)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "sub /data/new($) ->",
        "  out1,",
        "  out2",
        "value ->",
        "  first,",
        "  {",
        "  1 -> inner",
        "},",
        "  third",
      ].join("\n")
    );
  });

  it("formats selected parsed braced obligations whose first block starts after newline arrow", () => {
    const input = [
      "sub /data/new($) ->",
      "{",
      "1 -> inner",
      "}",
      "value ->",
      "{",
      "1 -> inner",
      "},",
      "third",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 8)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "sub /data/new($) ->",
        "  {",
        "  1 -> inner",
        "}",
        "value ->",
        "  {",
        "  1 -> inner",
        "},",
        "  third",
      ].join("\n")
    );
  });

  it("formats selected standalone comments attached to parsed multiline target and obligation continuations", () => {
    const input = [
      "value -> first,",
      "// keep target note",
      "second",
      "other_value -> first,",
      "{",
      "1 -> inner",
      "},",
      "// keep trailing target note",
      "third",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 8)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "value -> first,",
        "  // keep target note",
        "  second",
        "other_value -> first,",
        "  {",
        "  1 -> inner",
        "},",
        "  // keep trailing target note",
        "  third",
      ].join("\n")
    );
  });

  it("formats the selected portion of a parsed job body using structural indentation", () => {
    const input = [
      "job /example/test(x):",
      "sub /data/new($)->out",
      " end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 2)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("formats selected standalone multiline block comments inside parsed regions with structural indentation", () => {
    const input = [
      "job /example/test(x):",
      "/* keep  , -> spacing",
      "   and indentation */",
      "sub /data/new($)->out",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 3)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(x):",
        "  /* keep  , -> spacing",
        "     and indentation */",
        "  sub /data/new($) -> out",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline job headers with structural indentation", () => {
    const input = [
      "job /example/test(",
      "x,",
      "y) out1,",
      "out2",
      ":",
      "1 -> out1",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 5)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(",
        "  x,",
        "  y) out1,",
        "  out2",
        "  :",
        "  1 -> out1",
        "end",
      ].join("\n")
    );
  });

  it("formats selected standalone comments attached to parsed multiline job and def headers", () => {
    const input = [
      "job /example/test(",
      "// keep param note",
      "x,",
      "y) out1,",
      "// keep target note",
      "out2",
      ":",
      "1 -> out1",
      "end",
      "",
      "def helper(",
      "// keep helper note",
      "x,",
      "y):",
      "$  ->value",
      "end",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 14)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "job /example/test(",
        "  // keep param note",
        "  x,",
        "  y) out1,",
        "  // keep target note",
        "  out2",
        "  :",
        "  1 -> out1",
        "end",
        "",
        "def helper(",
        "  // keep helper note",
        "  x,",
        "  y):",
        "  $ -> value",
        "end",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline invocation continuations with structural indentation", () => {
    const input = [
      "sub /data/new(",
      "$,",
      "1,",
      "2) -> out1,",
      "out2",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 4)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "sub /data/new(",
        "  $,",
        "  1,",
        "  2) -> out1,",
        "  out2",
      ].join("\n")
    );
  });

  it("formats selected parsed multiline invocation continuations with braced obligations", () => {
    const input = [
      "sub /data/new(",
      "$,",
      "1) -> {",
      "$  -> inner",
      "}",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 4)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "sub /data/new(",
        "  $,",
        "  1) -> {",
        "  $ -> inner",
        "}",
      ].join("\n")
    );
  });

  it("formats selected standalone comments attached to parsed multiline invocation continuations", () => {
    const input = [
      "sub /data/new(",
      "// keep arg note",
      "$,",
      "1) ->",
      "// keep target note",
      "out1,",
      "out2",
      "join /example/protocol(",
      "// keep join arg note",
      "$,",
      "signal) -> {",
      "// keep obligation note",
      "$  -> second",
      "}",
    ].join("\n");

    const document = createDocument(input);
    const output = TextDocument.applyEdits(document, formatDocumentRange(document, 1, 12)).replace(/\r\n/g, "\n");

    expect(output).to.equal(
      [
        "sub /data/new(",
        "  // keep arg note",
        "  $,",
        "  1) ->",
        "  // keep target note",
        "  out1,",
        "  out2",
        "join /example/protocol(",
        "  // keep join arg note",
        "  $,",
        "  signal) -> {",
        "  // keep obligation note",
        "  $ -> second",
        "}",
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
