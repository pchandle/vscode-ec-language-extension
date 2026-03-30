/// <reference path="./globals.d.ts" />
import { expect } from "chai";
import { Range, Position } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { normalizeRangeToTouchedLines } from "../src/formattingRange";

function createDocument(text: string): TextDocument {
  return TextDocument.create("file:///formatting-range.dla", "emergent", 1, text);
}

describe("formattingRange", () => {
  it("excludes a trailing line when the selection ends at column zero on that line", () => {
    const document = createDocument(["job /example/test(x):", "sub /data/new($)->out", "  else", "end"].join("\n"));
    const range = Range.create(Position.create(1, 0), Position.create(2, 0));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 1,
      endLine: 1,
    });
  });

  it("keeps the trailing line when the selection reaches into that line", () => {
    const document = createDocument(["job /example/test(x):", "sub /data/new($)->out", "  else", "end"].join("\n"));
    const range = Range.create(Position.create(1, 0), Position.create(2, 2));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 1,
      endLine: 2,
    });
  });

  it("excludes a leading line when the selection starts at the end of that line and continues later", () => {
    const document = createDocument(["job /example/test(x):", "sub /data/new($)->out", "  else", "end"].join("\n"));
    const range = Range.create(Position.create(1, document.getText(Range.create(1, 0, 2, 0)).replace(/\r?\n$/, "").length), Position.create(2, 2));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 2,
    });
  });

  it("expands a selection touching an else line to include the immediate else-body line", () => {
    const document = createDocument(
      ["job /example/test(x):", "  if ready then", "    sub /data/new($)->out", " else", "    $  ->fallback", "  end", "end"].join("\n")
    );
    const range = Range.create(Position.create(3, 1), Position.create(3, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 3,
      endLine: 4,
    });
  });

  it("expands an else-line selection through comment and blank prefixes before the first body line", () => {
    const document = createDocument(
      [
        "job /example/test(x):",
        "  if ready then",
        "    sub /data/new($)->out",
        " else",
        "",
        "    // keep note",
        "    $  ->fallback",
        "  end",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(3, 1), Position.create(3, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 3,
      endLine: 6,
    });
  });

  it("expands a selected first else-body content line backward to the else delimiter", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "else", "$  ->fallback", "end"].join("\n")
    );
    const range = Range.create(Position.create(3, 1), Position.create(3, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 3,
    });
  });

  it("expands a selected first else-body content line backward through blank and comment suffix lines", () => {
    const document = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "else",
        "",
        "// keep fallback note",
        "$  ->fallback",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(5, 1), Position.create(5, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 5,
    });
  });

  it("keeps a later else-body content line line-bounded", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "else", "$ -> fallback1", "$ -> fallback2", "end"].join("\n")
    );
    const range = Range.create(Position.create(4, 1), Position.create(4, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 4,
      endLine: 4,
    });
  });

  it("expands a selected first then-body content line backward to a same-line then boundary", () => {
    const document = createDocument(
      ["if ready then", "sub /data/new($)->out", "end"].join("\n")
    );
    const range = Range.create(Position.create(1, 1), Position.create(1, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 0,
      endLine: 1,
    });
  });

  it("expands a selected first then-body content line backward through blank and comment suffix lines to standalone then", () => {
    const document = createDocument(
      [
        "if ready &&",
        "available",
        "then",
        "",
        "// keep then note",
        "sub /data/new($)->out",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(5, 1), Position.create(5, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 5,
    });
  });

  it("keeps a later then-body content line line-bounded", () => {
    const document = createDocument(
      ["if ready then", "sub /data/new($)->out1", "sub /data/new($)->out2", "end"].join("\n")
    );
    const range = Range.create(Position.create(2, 1), Position.create(2, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 2,
    });
  });

  it("expands a multiline if-header content line forward to the standalone then suffix", () => {
    const document = createDocument(
      ["if ready &&", "available", "then", "sub /data/new($)->out", "end"].join("\n")
    );
    const range = Range.create(Position.create(1, 1), Position.create(1, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 1,
      endLine: 2,
    });
  });

  it("expands a multiline if-header content line through blank and comment suffix lines to standalone then", () => {
    const document = createDocument(
      [
        "if ready &&",
        "available",
        "",
        "// keep condition note",
        "then",
        "sub /data/new($)->out",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(1, 1), Position.create(1, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 1,
      endLine: 4,
    });
  });

  it("keeps a same-line if-then header selection line-bounded", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "end"].join("\n")
    );
    const range = Range.create(Position.create(0, 1), Position.create(0, 8));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 0,
      endLine: 0,
    });
  });

  it("expands a selection touching a standalone then line backward to include the immediate header suffix", () => {
    const document = createDocument(
      ["if ready &&", "available", "then", "sub /data/new($)->out", "end"].join("\n")
    );
    const range = Range.create(Position.create(2, 1), Position.create(2, 4));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 1,
      endLine: 2,
    });
  });

  it("expands a standalone then-line selection backward through blank and comment suffix lines", () => {
    const document = createDocument(
      [
        "if ready &&",
        "available",
        "",
        "// keep condition note",
        "then",
        "sub /data/new($)->out",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(4, 1), Position.create(4, 4));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 1,
      endLine: 4,
    });
  });

  it("expands a selection touching a bare end line backward to include the immediate owned suffix", () => {
    const document = createDocument(
      ["job /example/test(x):", "  if ready then", "    sub /data/new($)->out", "    // keep note", "  end", "end"].join("\n")
    );
    const range = Range.create(Position.create(4, 2), Position.create(4, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 4,
    });
  });

  it("expands a bare end-line selection backward through blank and comment suffix lines", () => {
    const document = createDocument(
      [
        "job /example/test(x):",
        "  if ready then",
        "    sub /data/new($)->out",
        "",
        "    // keep note",
        "  end",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(5, 2), Position.create(5, 5));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 5,
    });
  });

  it("expands a selection touching an end-arrow continuation line to include the immediate continuation line", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "end -> result1,", "result2"].join("\n")
    );
    const range = Range.create(Position.create(2, 2), Position.create(2, 8));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 3,
    });
  });

  it("expands a selected first end-arrow continuation content line backward to the delimiter", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "end -> result1,", "result2", "end"].join("\n")
    );
    const range = Range.create(Position.create(3, 1), Position.create(3, 6));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 3,
    });
  });

  it("expands a selected first end-arrow continuation content line backward through blank and comment suffix lines", () => {
    const document = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "end -> result1,",
        "",
        "// keep target note",
        "result2",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(5, 1), Position.create(5, 6));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 5,
    });
  });

  it("keeps a later end-arrow continuation content line line-bounded", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "end -> result1,", "result2,", "result3", "end"].join("\n")
    );
    const range = Range.create(Position.create(4, 1), Position.create(4, 6));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 4,
      endLine: 4,
    });
  });

  it("keeps a later end-arrow continuation content line line-bounded across comment-separated continuation lines", () => {
    const document = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "end -> result1,",
        "// keep target note",
        "result2,",
        "result3",
        "end",
      ].join("\n")
    );
    const range = Range.create(Position.create(5, 1), Position.create(5, 6));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 5,
      endLine: 5,
    });
  });

  it("expands an end-arrow selection through blank and comment prefixes before the first continuation line", () => {
    const document = createDocument(
      [
        "if ready then",
        "  sub /data/new($)->out",
        "end -> result1,",
        "",
        "// keep target note",
        "result2",
      ].join("\n")
    );
    const range = Range.create(Position.create(2, 2), Position.create(2, 8));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 5,
    });
  });

  it("keeps a complete single-line end-arrow selection line-bounded", () => {
    const document = createDocument(
      ["if ready then", "  sub /data/new($)->out", "end -> result", "sub /next($)->out2"].join("\n")
    );
    const range = Range.create(Position.create(2, 2), Position.create(2, 8));

    expect(normalizeRangeToTouchedLines(document, range)).to.deep.equal({
      startLine: 2,
      endLine: 2,
    });
  });
});
