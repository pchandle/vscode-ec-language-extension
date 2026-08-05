# Component Manager traceability and acceptance

## Authoritative inputs

| Behaviour | Authority |
|---|---|
| Job blocks and labels | Parsed autopilot expressions |
| Contract interface | Resolved `.cspec` |
| Managed protocol interface | Valid `.pdes` transformed with its matching `.pdd` |
| Spec-only protocol interface | `.pspec` without a matching `.pdes` |
| Relationship binding | Selected protocol role and semantic `<self>` endpoint |
| Source navigation | URI/range projection from indexed source |

## Release acceptance scenarios

1. A configured directory with valid designs, definitions, contracts, and expressions appears after indexing.
2. A `.pspec` without a design is searchable and marked Spec-only.
3. Duplicate designs and unresolved/duplicate contracts surface linked diagnostics and block unsafe synchronization.
4. Saving a valid design or contract updates matching open expressions through undoable, unsaved edits only.
5. Ambiguous mappings make no source changes and report diagnostics.
6. Contract actions open one matching expression, ask the user to choose among several, or offer to create one when no match exists.
7. Graph lines connect only direct role `<self>` bindings; selections retain source navigation and open-beside modifiers.
