# Emergent expression formatting roadmap

## Current status

Formatting is implemented in the language server for `.dla` and `.dlp` files. It supports document and range formatting, syntax-aware indentation and selected blank-line normalization for successfully parsed structures, and conservative recovery formatting for malformed input. Strings and comments remain protected where structure is uncertain.

The completed formatter work includes:

- server-side document and range formatting;
- parser-backed ownership for multiline declarations, defaults, invocations, obligations, and `if` structures;
- structural indentation and delimiter alignment;
- comment-aware blank-line cleanup inside clearly owned regions;
- selection expansion only to the nearest established structural slice; and
- corpus tooling and idempotence coverage.

Automatic wrapping/reflow, formatting of specification/design JSON, and broad style configuration remain out of scope.

## Next recommended work

Use `npm run validate:formatting-corpus` with a representative local `.dla`/`.dlp` corpus. Review the largest diffs and choose one concrete, repeatable formatting problem for a bounded follow-up. Do not add rules solely from synthetic fixtures or broaden recovery formatting without corpus evidence.

The next formatter change must state its user-visible outcome, included syntax family, exclusions, acceptance criteria, and exit condition before implementation.

## Contribution contract

- Keep policy in `server/src/formatting.ts` and parser-owned helpers, not the extension host.
- Preserve semantics, literal contents, and comment text.
- Prefer the smallest syntax-owned rule over generic whitespace heuristics.
- Add parse-success, recovery, range-format, idempotence, and non-expansion tests as applicable.
- Run `npm run test:server`; also run `npm test` when the VS Code formatting surface changes.
- Update this document with the completed bounded rule and the next recommended corpus-backed slice.
