# Protocol design editor implementation

## File model

- `.pdes` is the editable protocol-design source.
- `.pspec` is an exported protocol specification.
- `.pdd` is a versioned protocol-design definition that supplies macro wrappers and mode templates.

The Protocol Design Editor resolves a `.pdd` by `protocolDesignVersion`: `protocolDesign.activeDefinition`, then `protocolDesign.definitionPaths`, then the bundled definition. If no matching definition exists, the editor reports the problem and the file can be opened as text.

## Editors and validation

The `.pdes` and `.pdd` custom editors modify the VS Code text document through undoable edits. The source schemas are `docs/developer/spec.schema.json` and `docs/developer/pdd.schema.json`; the webview build copies their runtime variants to `media` and compiles the generated validators.

The `.pdd` editor manages version, host/join macro globals, ordered mode templates, ordered topics, and ordered macro statements. Semantic validation detects duplicate mode-template names, missing `$TOPICS` in global definitions, and malformed or out-of-range `$TOPIC_n` references.

The `.pdes` editor manages classification, description, policy, ordered mode instances, collaboration labels, and properties supplied by the selected template. It blocks export when schema or semantic validation fails.

## Export and migration

**Emergent: Export Protocol Spec (from .pdes)** validates the active design, transforms it with the matching PDD, and writes a `.pspec`. Existing targets can be reviewed in a diff before overwrite. Each mode requires a non-blank Collaboration label; export derives the public topic name, macro parameter identifiers, and implicit `<self>` endpoints.

The Protocol Specification Editor supports guided migration from legacy `.pspec` to `.pdes`. Migration chooses compatible PDD templates when evidence is unique, requests review for ambiguous modes or labels, and never overwrites an existing same-named `.pdes`.
