"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rangeFromNode = exports.rangeFromTokens = exports.NodeKind = void 0;
var NodeKind;
(function (NodeKind) {
    NodeKind["Program"] = "Program";
    NodeKind["Statement"] = "Statement";
    NodeKind["Job"] = "Job";
    NodeKind["Def"] = "Def";
    NodeKind["If"] = "If";
    NodeKind["Block"] = "Block";
    NodeKind["Binary"] = "Binary";
    NodeKind["Unary"] = "Unary";
    NodeKind["Literal"] = "Literal";
    NodeKind["Identifier"] = "Identifier";
    NodeKind["Classification"] = "Classification";
    NodeKind["Qualified"] = "Qualified";
    NodeKind["Call"] = "Call";
    NodeKind["Scope"] = "Scope";
})(NodeKind = exports.NodeKind || (exports.NodeKind = {}));
function rangeFromTokens(start, end) {
    return { start: start.range.start, end: end.range.end };
}
exports.rangeFromTokens = rangeFromTokens;
function rangeFromNode(start, end) {
    return { start: start.range.start, end: end.range.end };
}
exports.rangeFromNode = rangeFromNode;
//# sourceMappingURL=ast.js.map