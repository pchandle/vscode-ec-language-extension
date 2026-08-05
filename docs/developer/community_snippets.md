# Contributing Emergent snippets

Bundled snippets live in `conf/emergent.tmSnippets.json` and are contributed to the `emergent` language through the extension manifest.

## When to add a snippet

Add a bundled snippet only when it represents a common Emergent authoring pattern and is meaningfully different from existing snippets or language completions. Keep it generic: do not add organisation-specific classifications, suppliers, or proprietary expression templates.

## Snippet format

Each entry uses VS Code’s user-snippet JSON format. Use an array for `prefix`, a `body` array with tab stops, and a concise description.

```json
"Subcontract": {
  "prefix": ["sub"],
  "body": ["sub ${1}(${2}) -> ${3}"],
  "description": "A sub-contracting statement."
}
```

Current bundled snippets cover defaults, jobs, subcontracts, host/join participation, conditionals, and basic `min`, `max`, and `len` calls. Follow their naming and indentation style.

## Contribution checklist

1. Add the entry to `conf/emergent.tmSnippets.json` with valid JSON.
2. Check for duplicate prefixes and ensure tab stops lead naturally through the template.
3. Verify the expanded text is valid or intentionally incomplete Emergent syntax.
4. Update user-facing documentation when the snippet adds a new discoverable workflow.
5. Run `npm run build` and the normal typecheck/lint gates before handoff.

For personal or team-only snippets, use VS Code’s [user-defined snippets](https://code.visualstudio.com/docs/editing/userdefinedsnippets) instead of changing the extension.
