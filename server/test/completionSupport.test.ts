import { expect } from "chai";
import { TextDocument } from "vscode-languageserver-textdocument";
import { buildCompletionItems, classifyContractName, ContractClassification } from "../src/completionSupport";

function mockDoc(text: string) {
  return TextDocument.create("file:///test.dla", "emergent", 1, text);
}

describe("completionSupport", () => {
  const contracts: ContractClassification[] = [
    { layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64" },
    { layer: "byte", verb: "add", subject: "integer", variation: "default", platform: "x64" },
    { layer: "data", verb: "load", subject: "file", variation: "default", platform: "linux" },
  ];

  it("classifies contract names", () => {
    const c = classifyContractName("/byte/new/integer/default/x64");
    expect(c).to.deep.equal(contracts[0]);
  });

  it("suggests verbs at start", () => {
    const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub ");
    const items = buildCompletionItems(contracts, doc, { line: 1, character: 4 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("new");
    expect(labels).to.include("/data/");
  });

  it("suggests subjects for matching verb", () => {
    const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub /byte/new/");
    const items = buildCompletionItems(contracts, doc, { line: 1, character: 14 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/byte/new/integer");
  });
});
