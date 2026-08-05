# Emergent Coding extension language guide

This is a practical guide to the expression syntax understood by this extension’s lexer, parser, formatter, diagnostics, and language server. It is not the complete Emergent language specification. For supplementary language material, see the bundled [Emergent Coding language PDF](./emergent-coding-language.pdf).

## Files and comments

The extension recognises Emergent expressions in `.dla` and `.dlp` files. Line comments begin with `//`. Formatting preserves comment text and is intentionally conservative around malformed code.

## Classifications and defaults

Contract classifications have five segments:

```emergent
/layer/verb/subject/variation/platform
```

Protocol classifications have four segments:

```emergent
/layer/subject/variation/platform
```

Use `defaults` to supply layer, variation, and platform values for shorthand classifications:

```emergent
defaults: behaviour, default, x64, codevalley
```

The language service normalises classifications before resolving specifications. Use `.` in a shorthand segment to select its configured default.

## Declarations and calls

`job` declares an expression with a contract classification, input labels, optional output labels, and an `end`-terminated body. A colon is required after the header.

```emergent
job /behaviour/prepare/example/default/x64(input) output:
    sub /data/transform/example/default/x64(input) -> output
end
```

`def` declares a reusable block with the same `end`-terminated body shape:

```emergent
def double(value) result:
    value + value -> result
end
```

`sub`, `host`, and `join` call a contract or protocol interface. Inputs appear in parentheses; output labels follow `->`. A `sub` call may include an `@supplier` qualifier. Supplier qualifiers are invalid on `host` and `join`.

```emergent
sub /data/transform/example/default/x64@codevalley(input) -> output
host /data/example/default/x64(input) -> output
join /data/example/default/x64(input) -> output
```

Arguments, targets, declaration headers, and defaults may continue across lines. A backslash can explicitly continue a call argument line.

## Blocks and conditionals

Brace obligations create a nested block after `->`:

```emergent
sub /data/transform/example/default/x64(input) -> {
    input -> output
}
```

Conditionals use `if`, `then`, optional `else`, and `end`. A conditional can also provide trailing output targets after `end ->`.

```emergent
if enabled then
    source -> result
else
    fallback -> result
end
```

## Literals and expressions

The parser supports integer literals in decimal, hexadecimal (`0x`), octal (`0o`), and binary (`0b`) notation; strings with common escaped characters; boolean values; identifiers; scope references such as `$`; calls; arithmetic; comparisons; and logical expressions.

The type checker validates supported expression operations and applies resolved contract/protocol interfaces to statement inputs and outputs. Diagnostics are authoritative when this guide and an installed language-server version differ.

## Formatting and editor assistance

Use **Format Document** or **Format Selection** for `.dla` and `.dlp` files. For successfully parsed structures, formatting normalises spacing, indentation, selected blank-line boundaries, and multiline ownership. For recovery-mode input, it preserves uncertain strings and comments while applying only safe cleanup.

Completions, links, specification lookup, and type hover depend on the cursor context and Studio specification availability. Classification and supplier tokens deliberately suppress type hover so their navigation and completion affordances remain clear.
