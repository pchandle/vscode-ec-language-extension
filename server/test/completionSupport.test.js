"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const completionSupport_1 = require("../src/completionSupport");
function mockDoc(text) {
    return vscode_languageserver_textdocument_1.TextDocument.create("file:///test.dla", "emergent", 1, text);
}
describe("completionSupport", () => {
    const contracts = [
        { layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64" },
        { layer: "byte", verb: "add", subject: "integer", variation: "default", platform: "x64" },
        { layer: "data", verb: "load", subject: "file", variation: "default", platform: "linux" },
        { layer: "logic", verb: "check", subject: "condition", variation: "or", platform: "core" },
        { layer: "logic", verb: "check", subject: "condition", variation: "not", platform: "core" },
    ];
    const protocols = [
        { layer: "byte", subject: "integer", variation: "default", platform: "x64" },
        { layer: "data", subject: "file", variation: "default", platform: "linux" },
        { layer: "data", subject: "integer", variation: "default", platform: "x64" },
    ];
    it("classifies contract names", () => {
        const c = (0, completionSupport_1.classifyContractName)("/byte/new/integer/default/x64");
        (0, chai_1.expect)(c).to.deep.equal(contracts[0]);
    });
    it("classifies protocol names", () => {
        const p = (0, completionSupport_1.classifyProtocolName)("/byte/integer/default/x64");
        (0, chai_1.expect)(p).to.deep.equal(protocols[0]);
    });
    it("suggests verbs at start", () => {
        const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub ");
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: 4 });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("new");
        (0, chai_1.expect)(labels).to.include("/data/");
    });
    it("suggests verbs at start for job", () => {
        const doc = mockDoc("defaults: byte, default, x64, codevalley\njob ");
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: 4 });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("new");
        (0, chai_1.expect)(labels).to.include("/data/");
    });
    it("suggests subjects for matching verb", () => {
        const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub /byte/new/");
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: 14 });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/new/integer");
    });
    it("suggests subjects for matching verb on job", () => {
        const doc = mockDoc("defaults: byte, default, x64, codevalley\njob /byte/new/");
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: 14 });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/new/integer");
    });
    it("suggests protocol subjects for host/join", () => {
        const hostLine = "host /byte/";
        const doc = mockDoc(`defaults: byte, default, x64, codevalley\n${hostLine}`);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: hostLine.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("integer");
    });
    it("suggests contract variations", () => {
        const line = "sub /byte/new/integer/d";
        const doc = mockDoc(`defaults: byte, default, x64, codevalley\n${line}`);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/new/integer/default");
    });
    it("suggests contract platforms", () => {
        const line = "sub /byte/new/integer/default/x";
        const doc = mockDoc(`defaults: byte, base, x64, codevalley\n${line}`);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/new/integer/default/x64");
    });
    it("suggests contract platforms when platform segment is empty", () => {
        const line = "sub /byte/new/integer/default/";
        const doc = mockDoc(`defaults: byte, base, x64, codevalley\n${line}`);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/new/integer/default/x64");
    });
    it("suggests contract platforms for job when platform segment is empty", () => {
        const line = "job /byte/new/integer/default/";
        const doc = mockDoc(`defaults: byte, base, x64, codevalley\n${line}`);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/new/integer/default/x64");
    });
    it("suggests protocol platforms", () => {
        const line = "host /byte/integer/default/x";
        const doc = mockDoc(`defaults: byte, base, x64, codevalley\n${line}`);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/byte/integer/default/x64");
    });
    it("suggests variations when no defaults or layer provided", () => {
        const line = "sub check/condition/";
        const doc = mockDoc(line);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 0, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("check/condition/or");
        (0, chai_1.expect)(labels).to.include("check/condition/not");
    });
    it("suggests protocol platform with partial input", () => {
        const line = "join /data/integer/default/x";
        const doc = mockDoc(line);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 0, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/data/integer/default/x64");
    });
    it("suggests protocol platform with empty platform segment", () => {
        const line = "join /data/integer/default/";
        const doc = mockDoc(line);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 0, character: line.length });
        const labels = items.map((i) => i.label);
        (0, chai_1.expect)(labels).to.include("/data/integer/default/x64");
    });
    it("bails out after whitespace following contract classification", () => {
        const line = "sub /byte/new/integer/default/x64 param";
        const doc = mockDoc(line);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 0, character: line.length });
        (0, chai_1.expect)(items).to.deep.equal([]);
    });
    it("bails out after '(' following contract classification", () => {
        const line = "sub /byte/new/integer/default/x64(param1";
        const doc = mockDoc(line);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 0, character: line.length });
        (0, chai_1.expect)(items).to.deep.equal([]);
    });
    it("bails out after '@' following protocol classification", () => {
        const line = "join /data/integer/default/x64@codevalley foo";
        const doc = mockDoc(line);
        const items = (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 0, character: line.length });
        (0, chai_1.expect)(items).to.deep.equal([]);
    });
    it("builds contract spec completion after opening parenthesis", () => {
        const line = "sub /byte/new/integer/default/x64(";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.length };
        const context = (0, completionSupport_1.shouldTriggerContractSpecCompletion)(doc, position);
        const spec = {
            requirements: [{ name: "First Requirement" }, { name: "Second-Req" }],
            obligations: [{ name: "Do Thing" }],
        };
        const items = context && (0, completionSupport_1.buildContractSpecCompletionItems)(spec, position, context.lineText, context.openParenIndex, "sub");
        (0, chai_1.expect)(items?.[0].textEdit && "newText" in items[0].textEdit ? items[0].textEdit.newText : undefined).to.equal("first_requirement, second_req) -> do_thing");
        const editRange = items?.[0].textEdit && "range" in items[0].textEdit ? items[0].textEdit.range : null;
        (0, chai_1.expect)(editRange).to.deep.equal({
            start: { line: 0, character: line.indexOf("(") + 1 },
            end: { line: 0, character: line.length },
        });
    });
    it("does not trigger spec completion when arguments already typed", () => {
        const line = "sub /byte/new/integer/default/x64(foo";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.length };
        const context = (0, completionSupport_1.shouldTriggerContractSpecCompletion)(doc, position);
        (0, chai_1.expect)(context).to.equal(null);
    });
    it("does not trigger spec completion when text follows the cursor", () => {
        const line = "sub /byte/new/integer/default/x64(";
        const fullLine = `${line} foo`;
        const doc = mockDoc(fullLine);
        const position = { line: 0, character: line.length };
        const context = (0, completionSupport_1.shouldTriggerContractSpecCompletion)(doc, position);
        (0, chai_1.expect)(context).to.equal(null);
    });
    it("allows spec completion when closing parenthesis is already present", () => {
        const line = "sub /byte/new/integer/default/x64()";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.indexOf("(") + 1 };
        const context = (0, completionSupport_1.shouldTriggerContractSpecCompletion)(doc, position);
        (0, chai_1.expect)(context).to.not.equal(null);
    });
    it("builds job spec completion with trailing colon", () => {
        const line = "job /byte/new/integer/default/x64(";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.length };
        const context = (0, completionSupport_1.shouldTriggerContractSpecCompletion)(doc, position);
        const spec = {
            requirements: [{ name: "Input" }],
            obligations: [{ name: "Do Thing" }, { name: "Other" }],
        };
        const items = context && (0, completionSupport_1.buildContractSpecCompletionItems)(spec, position, context.lineText, context.openParenIndex, "job");
        (0, chai_1.expect)(items?.[0].textEdit && "newText" in items[0].textEdit ? items[0].textEdit.newText : undefined).to.equal("input) do_thing, other:");
    });
    it("builds protocol host spec completion after opening parenthesis", () => {
        const line = "host /byte/integer/default/x64(";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.length };
        const context = (0, completionSupport_1.shouldTriggerProtocolSpecCompletion)(doc, position);
        const spec = {
            host: {
                requirements: [{ name: "First Requirement" }, { name: "Second-Req" }],
                obligations: [{ name: "Do Thing" }],
            },
        };
        const items = context && (0, completionSupport_1.buildProtocolSpecCompletionItems)(spec, position, context.lineText, context.openParenIndex, "host");
        (0, chai_1.expect)(items?.[0].textEdit && "newText" in items[0].textEdit ? items[0].textEdit.newText : undefined).to.equal("first_requirement, second_req) -> do_thing");
        const editRange = items?.[0].textEdit && "range" in items[0].textEdit ? items[0].textEdit.range : null;
        (0, chai_1.expect)(editRange).to.deep.equal({
            start: { line: 0, character: line.indexOf("(") + 1 },
            end: { line: 0, character: line.length },
        });
    });
    it("builds protocol join spec completion with closing parenthesis already present", () => {
        const line = "join /data/integer/default/x64()";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.indexOf("(") + 1 };
        const context = (0, completionSupport_1.shouldTriggerProtocolSpecCompletion)(doc, position);
        const spec = {
            join: {
                requirements: [{ name: "Input" }],
                obligations: [{ name: "Respond" }, { name: "Ack Result" }],
            },
        };
        const items = context && (0, completionSupport_1.buildProtocolSpecCompletionItems)(spec, position, context.lineText, context.openParenIndex, "join");
        (0, chai_1.expect)(items?.[0].textEdit && "newText" in items[0].textEdit ? items[0].textEdit.newText : undefined).to.equal("input) -> respond, ack_result");
    });
});
//# sourceMappingURL=completionSupport.test.js.map