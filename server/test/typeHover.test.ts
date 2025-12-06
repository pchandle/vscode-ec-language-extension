import { strict as assert } from "assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseText } from "../lang/parser";
import { typeCheckProgram } from "../lang/typeChecker";
import { getTypeHoverMarkdown } from "../src/typeHover";

function rangesEqual(a: any, b: any): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

describe("type hover with contract specs", () => {
  it("applies obligation types from inline sub classifications to targets", () => {
    const text = "sub /data/check/condition(x) -> condition, true_, false_";
    const spec = {
      name: "check condition",
      obligations: [
        { name: "condition", type: "/data/boolean-condition/default/x64" },
        { name: "true", type: "/data/flow/default/x64" },
        { name: "false", type: "/data/flow/default/x64" }
      ]
    };

    const { program } = parseText(text);
    const targetToken = (program.statements[0] as any).targets[0];
    const { types } = typeCheckProgram(program, {
      collectTypes: true,
      contractSpecs: { "/data/check/condition/default/x64": spec as any }
    });

    const match = types?.find((t) => rangesEqual(t.range, targetToken.range));
    assert.ok(match, "expected a type record for the first target");
    assert.equal(
      (match!.types[0] as any).classification,
      "/data/boolean-condition/default/x64",
      "expected classification from spec obligation"
    );

    const doc = TextDocument.create("file:///test.dla", "emergent", 1, text);
    const hover = getTypeHoverMarkdown(doc, targetToken.range.start, {
      "/data/check/condition/default/x64": spec as any
    });
    assert.ok(hover && hover.includes("/data/boolean-condition/default/x64"), `hover did not include classification: ${hover}`);
  });
});
