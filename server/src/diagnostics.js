"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDiagnostics = void 0;
const vscode_languageserver_1 = require("vscode-languageserver");
const parser_1 = require("./lang/parser");
const resolver_1 = require("./lang/resolver");
function collectDiagnostics(textDocument, settings) {
    const { program, diagnostics: syntaxDiagnostics } = (0, parser_1.parseText)(textDocument.getText());
    const { diagnostics: resolverDiagnostics } = (0, resolver_1.resolveProgram)(program);
    const combined = [...syntaxDiagnostics, ...resolverDiagnostics];
    return combined.slice(0, settings.maxNumberOfProblems).map((diag) => ({
        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
        range: diag.range,
        message: diag.message,
        source: "emergent",
    }));
}
exports.collectDiagnostics = collectDiagnostics;
//# sourceMappingURL=diagnostics.js.map