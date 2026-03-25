/// <reference path="./globals.d.ts" />
import { expect } from "chai";
import { TextDocument } from "vscode-languageserver-textdocument";
import { formatDocument } from "../src/formatting";

function createDocument(text: string): TextDocument {
  return TextDocument.create("file:///formatting.dla", "emergent", 1, text);
}

function applyEdits(document: TextDocument, text: string): string {
  const edits = formatDocument(document);
  return TextDocument.applyEdits(document, edits).replace(/\r\n/g, "\n");
}

describe("formatting", () => {
  it("matches current spacing cleanup behavior", () => {
    const input = [
      "job /example/test(a,b)->out",
      "  value1  ,value2  ->out2  ",
      "// keep   comment spacing",
      "end",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /example/test(a, b) -> out",
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
      "job /broken/test(a,b)->",
      "  value1  ,value2  ->  ",
      "end  ",
    ].join("\n");

    const output = applyEdits(createDocument(input), input);

    expect(output).to.equal(
      [
        "job /broken/test(a, b) ->",
        "  value1, value2 ->",
        "end",
      ].join("\n")
    );
  });
});
