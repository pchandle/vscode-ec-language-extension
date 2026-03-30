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
