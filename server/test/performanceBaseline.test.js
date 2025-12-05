"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const perf_hooks_1 = require("perf_hooks");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const completionSupport_1 = require("../src/completionSupport");
const diagnostics_1 = require("../src/diagnostics");
function benchmark(label, iterations, fn) {
    const start = perf_hooks_1.performance.now();
    let max = 0;
    for (let i = 0; i < iterations; i++) {
        const before = perf_hooks_1.performance.now();
        fn();
        const duration = perf_hooks_1.performance.now() - before;
        if (duration > max) {
            max = duration;
        }
    }
    const total = perf_hooks_1.performance.now() - start;
    const mean = total / iterations;
    return { label, iterations, mean, max, total };
}
function mockDoc(text) {
    return vscode_languageserver_textdocument_1.TextDocument.create("file:///perf.dla", "emergent", 1, text);
}
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
describe("performance baseline", () => {
    it("collects diagnostics quickly", () => {
        const doc = mockDoc("defaults: byte, default, x64, codevalley\nABC DEF GHI\nlowercase ok\n");
        const result = benchmark("diagnostics", 200, () => (0, diagnostics_1.collectDiagnostics)(doc, { maxNumberOfProblems: 1000 }));
        console.log(`diagnostics mean=${result.mean.toFixed(3)}ms max=${result.max.toFixed(3)}ms iterations=${result.iterations}`);
        (0, chai_1.expect)(result.mean).to.be.lessThan(5);
        (0, chai_1.expect)(result.max).to.be.lessThan(15);
    });
    it("builds completion lists quickly", () => {
        const doc = mockDoc("defaults: byte, default, x64, codevalley\nsub /byte/new/");
        const result = benchmark("completion", 200, () => (0, completionSupport_1.buildCompletionItems)(contracts, protocols, doc, { line: 1, character: 14 }));
        console.log(`completion mean=${result.mean.toFixed(3)}ms max=${result.max.toFixed(3)}ms iterations=${result.iterations}`);
        (0, chai_1.expect)(result.mean).to.be.lessThan(5);
        (0, chai_1.expect)(result.max).to.be.lessThan(15);
    });
    it("builds spec completion quickly", () => {
        const line = "sub /byte/new/integer/default/x64(";
        const doc = mockDoc(line);
        const position = { line: 0, character: line.length };
        const spec = {
            requirements: [{ name: "First Requirement" }, { name: "Second-Req" }],
            obligations: [{ name: "Do Thing" }],
        };
        const context = (0, completionSupport_1.shouldTriggerContractSpecCompletion)(doc, position);
        const result = benchmark("spec completion", 100, () => context &&
            (0, completionSupport_1.buildContractSpecCompletionItems)(spec, position, context.lineText, context.openParenIndex, "sub"));
        console.log(`spec-completion mean=${result.mean.toFixed(3)}ms max=${result.max.toFixed(3)}ms iterations=${result.iterations}`);
        (0, chai_1.expect)(result.mean).to.be.lessThan(5);
        (0, chai_1.expect)(result.max).to.be.lessThan(15);
    });
});
//# sourceMappingURL=performanceBaseline.test.js.map