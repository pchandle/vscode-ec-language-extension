"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRange = exports.KEYWORDS = exports.TokenKind = void 0;
var TokenKind;
(function (TokenKind) {
    TokenKind["EOF"] = "EOF";
    TokenKind["Identifier"] = "Identifier";
    TokenKind["Keyword"] = "Keyword";
    TokenKind["Boolean"] = "Boolean";
    TokenKind["Integer"] = "Integer";
    TokenKind["String"] = "String";
    TokenKind["Classification"] = "Classification";
    TokenKind["Scope"] = "Scope";
    TokenKind["Supplier"] = "Supplier";
    TokenKind["Arrow"] = "Arrow";
    TokenKind["Colon"] = "Colon";
    TokenKind["LBrace"] = "LBrace";
    TokenKind["RBrace"] = "RBrace";
    TokenKind["LParen"] = "LParen";
    TokenKind["RParen"] = "RParen";
    TokenKind["Comma"] = "Comma";
    TokenKind["EqualsEquals"] = "EqualsEquals";
    TokenKind["BangEquals"] = "BangEquals";
    TokenKind["LessEquals"] = "LessEquals";
    TokenKind["GreaterEquals"] = "GreaterEquals";
    TokenKind["LessThan"] = "LessThan";
    TokenKind["GreaterThan"] = "GreaterThan";
    TokenKind["AndAnd"] = "AndAnd";
    TokenKind["OrOr"] = "OrOr";
    TokenKind["Plus"] = "Plus";
    TokenKind["Minus"] = "Minus";
    TokenKind["Star"] = "Star";
    TokenKind["Slash"] = "Slash";
    TokenKind["Percent"] = "Percent";
    TokenKind["Bang"] = "Bang";
    TokenKind["At"] = "At";
    TokenKind["Newline"] = "Newline";
    TokenKind["Unknown"] = "Unknown";
})(TokenKind = exports.TokenKind || (exports.TokenKind = {}));
exports.KEYWORDS = new Set([
    "defaults",
    "asset",
    "job",
    "sub",
    "host",
    "join",
    "deliver",
    "def",
    "if",
    "then",
    "else",
    "end",
    "true",
    "false",
    "max",
    "min",
    "concat",
    "len",
    "maxlen",
    "trunc",
    "replace",
    "escape",
    "int2str",
    "pack",
    "pad",
]);
function makeRange(startOffset, endOffset, start, end) {
    return {
        start,
        end,
    };
}
exports.makeRange = makeRange;
//# sourceMappingURL=tokens.js.map