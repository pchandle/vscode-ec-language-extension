"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProgram = void 0;
const tokens_1 = require("./tokens");
const ast_1 = require("./ast");
const BUILTIN_SCOPE_TOKEN = {
    kind: tokens_1.TokenKind.Scope,
    lexeme: "$",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
};
function makeScope(parent) {
    const scope = { parent, bindings: new Map() };
    scope.bindings.set("$", { name: BUILTIN_SCOPE_TOKEN, kind: "builtin", origin: "builtin" });
    return scope;
}
function declare(scope, token, kind, diagnostics, origin = "body") {
    const name = token.lexeme;
    if (!name || name === "_") {
        return;
    }
    if (name === "$") {
        diagnostics.push({ message: "Cannot redeclare reserved name '$'", range: token.range });
        return;
    }
    const existing = scope.bindings.get(name);
    if (existing) {
        if (existing.origin === "header" && existing.kind === "target" && kind === "target" && origin === "body") {
            // Assigning to a header-declared target; allowed.
            return;
        }
        diagnostics.push({ message: `Duplicate declaration of '${name}'`, range: token.range });
        return;
    }
    scope.bindings.set(name, { name: token, kind, origin });
}
const RESERVED_KEYWORDS = new Set(["sub", "job", "host", "join", "deliver", "def", "if", "then", "else", "end"]);
function resolveToken(scope, token) {
    if (token.lexeme === "_" || token.lexeme === "$") {
        // '_' is intentionally ignored; '$' is a builtin injected per scope.
        return scope.bindings.get("$");
    }
    if (token.kind === tokens_1.TokenKind.Keyword && RESERVED_KEYWORDS.has(token.lexeme.toLowerCase())) {
        return scope.bindings.get("$"); // treat reserved keywords as built-ins; no diagnostic
    }
    let current = scope;
    while (current) {
        const binding = current.bindings.get(token.lexeme);
        if (binding) {
            return binding;
        }
        current = current.parent;
    }
    return undefined;
}
function resolveExpression(expr, scope, diagnostics) {
    if (!expr)
        return;
    switch (expr.kind) {
        case ast_1.NodeKind.Identifier: {
            const id = expr;
            if (!resolveToken(scope, id.token)) {
                diagnostics.push({ message: `Undefined name '${id.token.lexeme}'`, range: id.token.range });
            }
            break;
        }
        case ast_1.NodeKind.Scope: {
            const scopeRef = expr;
            if (!resolveToken(scope, scopeRef.token)) {
                diagnostics.push({ message: "Undefined scope reference '$'", range: scopeRef.range });
            }
            break;
        }
        case ast_1.NodeKind.Classification:
        case ast_1.NodeKind.Literal:
            break;
        case ast_1.NodeKind.Unary:
            resolveExpression(expr.operand, scope, diagnostics);
            break;
        case ast_1.NodeKind.Binary:
            resolveExpression(expr.left, scope, diagnostics);
            resolveExpression(expr.right, scope, diagnostics);
            break;
        case ast_1.NodeKind.Qualified: {
            const qualified = expr;
            resolveExpression(qualified.base, scope, diagnostics);
            break;
        }
        case ast_1.NodeKind.Call:
            resolveExpression(expr.callee, scope, diagnostics);
            for (const arg of expr.args) {
                resolveExpression(arg, scope, diagnostics);
            }
            break;
    }
}
function resolveBlock(block, scope, diagnostics) {
    for (const stmt of block.statements) {
        resolveStatement(stmt, scope, diagnostics);
    }
}
function resolveIf(ifNode, scope, diagnostics) {
    resolveExpression(ifNode.condition, scope, diagnostics);
    const thenScope = makeScope(scope);
    resolveBlock(ifNode.thenBlock, thenScope, diagnostics);
    if (ifNode.elseBlock) {
        const elseScope = makeScope(scope);
        resolveBlock(ifNode.elseBlock, elseScope, diagnostics);
    }
}
function resolveStatement(stmt, scope, diagnostics) {
    switch (stmt.kind) {
        case ast_1.NodeKind.Job: {
            const job = stmt;
            const jobScope = makeScope(scope);
            for (const param of job.params) {
                declare(jobScope, param, "param", diagnostics, "header");
            }
            for (const target of job.targets) {
                declare(jobScope, target, "target", diagnostics, "header");
            }
            resolveBlock(job.body, jobScope, diagnostics);
            return;
        }
        case ast_1.NodeKind.Def: {
            const def = stmt;
            // def name is visible in enclosing scope
            declare(scope, def.name, "def", diagnostics, "header");
            const defScope = makeScope(scope);
            for (const param of def.params) {
                declare(defScope, param, "param", diagnostics, "header");
            }
            for (const target of def.targets) {
                declare(defScope, target, "target", diagnostics, "header");
            }
            resolveBlock(def.body, defScope, diagnostics);
            return;
        }
        case ast_1.NodeKind.Statement: {
            resolveExpression(stmt.expression, scope, diagnostics);
            for (const target of stmt.targets) {
                declare(scope, target, "target", diagnostics, "body");
            }
            if (stmt.block) {
                // Braced blocks do not create new scopes; they leak to the current scope.
                resolveBlock(stmt.block, scope, diagnostics);
            }
            return;
        }
        default:
            return;
    }
}
function resolveProgram(program) {
    const diagnostics = [];
    const rootScope = makeScope();
    for (const stmt of program.statements) {
        resolveStatement(stmt, rootScope, diagnostics);
    }
    return { diagnostics };
}
exports.resolveProgram = resolveProgram;
//# sourceMappingURL=resolver.js.map