# Custom Protocol Editor Design

## Core Workflow
- Edit `.pdes` as the source of truth; provide an explicit “Export to .pspec” action.
- On open, read `protocolDesignVersion` from `.pdes`, load matching `.pdd`. If unknown/missing, warn and offer to open the file in a text editor.
- Preserve file ordering/format to keep diffs clean; retain unknown fields on save or warn before dropping them.

## Protocol Design Definition (`.pdd`) Handling
- Bundled default at `resources/pdd/default.pdd`.
- Settings hold a list of `.pdd` definition paths; user selects the active one per workspace. Default falls back to the bundled file.
- On export/edit, use the selected `.pdd` to interpret templates and macros.

## UI Structure
- Header: show `classification` (4-segment protocol id), `description`, `policy` (editable); `protocolDesignVersion` read-only from file.
- Modes list: ordered; allow reordering (up/down or drag).
  - Add mode: choose `modeTemplate` from loaded `.pdd`.
  - Mode detail:
    - Topics shown in template-defined order (no reordering).
    - Editable fields per topic: `name` and `properties` only.
    - Display inherited `role`, `constraint`, and `type` as read-only badges.
    - Property inputs per type:
      - `abstraction`: `protocol` (string).
      - `integer`: `minimum` (number), `maximum` (number), `hint` (string).
      - `string`: `length` (number), `hint` (string).
      - `boolean`: no properties.
    - Show computed topic identifier (lowercase, non-alnum → `_`, suffix to disambiguate); warn on collisions.

## Validation
- Enforce required properties per topic type and numeric constraints for integer/length fields.
- Block export when validation fails; show inline errors.

## Macro Preview
- Live view of:
  - `def` params: all requirement identifiers (host + join) followed by all obligation identifiers (host + join) with `$TOPICS` expanded.
  - Host/join macro expansions with `$TOPIC_n` resolved and `$TOPICS` expanded.

## Export Flow
- Target path selection for `.pspec`.
- If target exists: prompt first. If user opts to review, generate and show diff (existing vs. new) side-by-side; overwrite only on confirm. If they decline, cancel export.
- If target does not exist: generate and save directly after validation.

## Commands and Settings (suggested)
- Commands: “Open .pdes”, “Export .pspec”, “Switch protocol design definition”.
- Settings: list of `.pdd` paths (select active), default bundled path, export path defaults, optional schema validation toggle.
