import { strict as assert } from "assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { NodeKind } from "../src/lang/ast";
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

  it("maps obligations across inline blocks and targets in order", () => {
    const text = `
sub /data/check/condition(check) -> condA, yesA, noA
sub /data/check/condition(check) -> { $ -> condB }, yesB, noB
sub /data/check/condition(check) -> { $ -> condC }, { $ -> yesC }, { $ -> noC }
sub /data/check/condition(check) -> condD, yesD, { $ -> noD }
`;
    const spec = {
      name: "check condition",
      obligations: [
        { name: "condition", type: "/data/boolean-condition/default/x64" },
        { name: "true", type: "/data/flow/default/x64" },
        { name: "false", type: "/data/flow/default/x64" }
      ]
    };

    const { program } = parseText(text);
    const { types } = typeCheckProgram(program, {
      collectTypes: true,
      contractSpecs: { "/data/check/condition/default/x64": spec as any }
    });

    function findTargetToken(name: string): any {
      function walk(stmt: any): any | undefined {
        if (stmt.targets) {
          const hit = stmt.targets.find((t: any) => t.lexeme === name);
          if (hit) return hit;
        }
        if (stmt.block) {
          for (const inner of stmt.block.statements) {
            const res = walk(inner as any);
            if (res) return res;
          }
        }
        if (stmt.obligationOrder) {
          for (const item of stmt.obligationOrder) {
            if ((item as any).kind === NodeKind.Block) {
              for (const inner of (item as any).statements ?? []) {
                const res = walk(inner as any);
                if (res) return res;
              }
            }
          }
        }
        return undefined;
      }
      for (const stmt of (program as any).statements) {
        const res = walk(stmt as any);
        if (res) return res;
      }
      return undefined;
    }

    function typeOf(name: string): any {
      const tok = findTargetToken(name);
      if (!tok) throw new Error(`token ${name} not found`);
      const match = types?.find((t) => rangesEqual(t.range, tok.range));
      return match?.types[0];
    }

    assert.equal((typeOf("condA") as any).classification, "/data/boolean-condition/default/x64");
    assert.equal((typeOf("yesA") as any).classification, "/data/flow/default/x64");
    assert.equal((typeOf("noA") as any).classification, "/data/flow/default/x64");

    assert.equal((typeOf("condB") as any).classification, "/data/boolean-condition/default/x64");
    assert.equal((typeOf("yesB") as any).classification, "/data/flow/default/x64");
    assert.equal((typeOf("noB") as any).classification, "/data/flow/default/x64");

    assert.equal((typeOf("condC") as any).classification, "/data/boolean-condition/default/x64");
    assert.equal((typeOf("yesC") as any).classification, "/data/flow/default/x64");
    assert.equal((typeOf("noC") as any).classification, "/data/flow/default/x64");

    assert.equal((typeOf("condD") as any).classification, "/data/boolean-condition/default/x64");
    assert.equal((typeOf("yesD") as any).classification, "/data/flow/default/x64");
    assert.equal((typeOf("noD") as any).classification, "/data/flow/default/x64");
  });

  it("includes trailing inline targets after a braced obligation on the next line", () => {
    const text = `
sub /data/check/condition(check) -> {
  $ -> condE
}, yesE, noE
`;
    const spec = {
      name: "check condition",
      obligations: [
        { name: "condition", type: "/data/boolean-condition/default/x64" },
        { name: "true", type: "/data/flow/default/x64" },
        { name: "false", type: "/data/flow/default/x64" }
      ]
    };
    const { program } = parseText(text);
    const { types } = typeCheckProgram(program, {
      collectTypes: true,
      contractSpecs: { "/data/check/condition/default/x64": spec as any }
    });

    function rangesEqual(a: any, b: any): boolean {
      return (
        a.start.line === b.start.line &&
        a.start.character === b.start.character &&
        a.end.line === b.end.line &&
        a.end.character === b.end.character
      );
    }

    const stmt: any = program.statements[0];
    const yesTok = stmt.targets.find((t: any) => t.lexeme === "yesE");
    const noTok = stmt.targets.find((t: any) => t.lexeme === "noE");
    const yesType = types?.find((t) => rangesEqual(t.range, yesTok.range))?.types[0];
    const noType = types?.find((t) => rangesEqual(t.range, noTok.range))?.types[0];

    assert.equal((yesType as any).classification, "/data/flow/default/x64");
    assert.equal((noType as any).classification, "/data/flow/default/x64");
  });
});
