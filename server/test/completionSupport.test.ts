import { expect } from "chai";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  buildCompletionItems,
  classifyContractName,
  ContractClassification,
  ProtocolClassification,
  classifyProtocolName,
} from "../src/completionSupport";

function mockDoc(text: string) {
  return TextDocument.create("file:///test.dla", "emergent", 1, text);
}

describe("completionSupport", () => {
  const contracts: ContractClassification[] = [
    { layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64" },
    { layer: "byte", verb: "add", subject: "integer", variation: "default", platform: "x64" },
    { layer: "data", verb: "load", subject: "file", variation: "default", platform: "linux" },
    { layer: "logic", verb: "check", subject: "condition", variation: "or", platform: "core" },
    { layer: "logic", verb: "check", subject: "condition", variation: "not", platform: "core" },
  ];
  const protocols: ProtocolClassification[] = [
    { layer: "byte", subject: "integer", variation: "default", platform: "x64" },
    { layer: "data", subject: "file", variation: "default", platform: "linux" },
    { layer: "data", subject: "integer", variation: "default", platform: "x64" },
  ];

  it("classifies contract names", () => {
    const c = classifyContractName("/byte/new/integer/default/x64");
    expect(c).to.deep.equal(contracts[0]);
  });

  it("classifies protocol names", () => {
    const p = classifyProtocolName("/byte/integer/default/x64");
    expect(p).to.deep.equal(protocols[0]);
  });

  it("suggests verbs at start", () => {
    const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub ");
    const items = buildCompletionItems(contracts, protocols, doc, { line: 1, character: 4 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("new");
    expect(labels).to.include("/data/");
  });

  it("suggests subjects for matching verb", () => {
    const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub /byte/new/");
    const items = buildCompletionItems(contracts, protocols, doc, { line: 1, character: 14 });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/byte/new/integer");
  });

  it("suggests protocol subjects for host/join", () => {
    const hostLine = "host /byte/";
    const doc = mockDoc(`defaults: byte, default, x64, codevalley\n${hostLine}`);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 1, character: hostLine.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("integer");
  });

  it("suggests contract variations", () => {
    const line = "sub /byte/new/integer/d";
    const doc = mockDoc(`defaults: byte, default, x64, codevalley\n${line}`);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 1, character: line.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/byte/new/integer/default");
  });

  it("suggests contract platforms", () => {
    const line = "sub /byte/new/integer/default/x";
    const doc = mockDoc(`defaults: byte, base, x64, codevalley\n${line}`);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 1, character: line.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/byte/new/integer/default/x64");
  });

  it("suggests protocol platforms", () => {
    const line = "host /byte/integer/default/x";
    const doc = mockDoc(`defaults: byte, base, x64, codevalley\n${line}`);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 1, character: line.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/byte/integer/default/x64");
  });

  it("suggests variations when no defaults or layer provided", () => {
    const line = "sub check/condition/";
    const doc = mockDoc(line);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 0, character: line.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("check/condition/or");
    expect(labels).to.include("check/condition/not");
  });

  it("suggests protocol platform with partial input", () => {
    const line = "join /data/integer/default/x";
    const doc = mockDoc(line);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 0, character: line.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/data/integer/default/x64");
  });

  it("suggests protocol platform with empty platform segment", () => {
    const line = "join /data/integer/default/";
    const doc = mockDoc(line);
    const items = buildCompletionItems(contracts, protocols, doc, { line: 0, character: line.length });
    const labels = items.map((i) => i.label);
    expect(labels).to.include("/data/integer/default/x64");
  });
});
