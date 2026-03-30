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
});
