# Protocol Design and Specification Editor Requirements

## File Roles
- `.pdes` (protocol design): source of truth edited in the custom editor.
- `.pspec` (protocol specification): exported artifact derived from `.pdes`.
- `.pdd` (protocol design definition): source-controlled JSON that defines macro wrappers, mode templates, and the `protocolDesignVersion`.

## Versioning and Compatibility
- `.pdes` includes `protocolDesignVersion` (integer).
- Editor behavior: if a `.pdes` references an unknown version, show a warning and offer to open it in the default text editor.
- `.pdd` stores `protocolDesignVersion` and the macro/mode template definitions for that version.

## `.pdes` Structure
- Top-level fields: `protocolDesignVersion`, `classification`, `description`, `policy`. The design accepts an integer or numeric string policy; export emits a canonical numeric string.
- `modes`: ordered array; concatenation order drives downstream ordering.
  - Each mode instance:
    - `modeTemplate`: references a mode template name in the `.pdd`.
    - `collaborationLabel`: required non-blank public label for the mode. It is displayed in the editor and exported as the name of every topic in that mode.
    - `topics`: ordered array (order defined by the mode template).
      - Each topic item:
        - `name`: editor label seeded from the mode template; it is not exported as the public topic name.
        - `properties`: values for the mandatory properties declared by the topic’s type in the mode template.
        - `role` and `constraint` are inherited from the referenced mode template topic; they are not repeated in the `.pdes` topic instance.

## Topic Types and Mandatory Properties
- `abstraction`: `protocol` (string).
- `integer`: `minimum` (int), `maximum` (int), `hint` (string).
- `string`: `length` (int), `hint` (string).
- `boolean`: no mandatory properties.

## Topic Identifiers
- Derived from topic label: lowercase, replace non-`[a-z0-9]` with `_`.
- Append unpadded decimal suffix only when needed to disambiguate duplicates.
- Identifiers are positional; names are not guaranteed unique.

## Ordering Rules for Export
- For each exported array (host requirements, host obligations, join requirements, join obligations):
  - Concatenate modes in `.pdes` order.
  - Within each mode, use the mode template’s topic order.
- Each macro `def` parameter list is side-local: host macros receive host topic identifiers and join macros receive join topic identifiers. For each side, requirements precede obligations; each group retains `.pdes` mode/topic order. Replace a single `$TOPICS` token in the corresponding macro wrapper with this list.

## Macros and Templates
- Macro wrapper text (def/header/footer) lives in `.pdd` with the versioned definition.
- Each mode template contributes ordered macro sub-statements to host and/or join macros.
  - Tokens use `$TOPIC_n`, where `n` is the mode template’s topic index.
  - Sub-statements are combined in mode order, preserving each template’s sub-statement order.
- No explicit macros are stored in `.pdes`; they are derived from the templates and instantiated topics.

## `.pdd` Structure (Protocol Design Definition)
- Top-level `protocolDesignVersion` (int).
- Macro wrapper strings stored under:
  - `hostMacroGlobal`: `def` (contains `$TOPICS`), `header`, `footer`.
  - `joinMacroGlobal`: `def` (contains `$TOPICS`), `header`, `footer`.
- `modeTemplates`: array of templates. Each template includes:
  - `name`: referenced by `.pdes` mode `modeTemplate`.
  - `topics`: ordered array; each entry declares:
    - `name`
    - `role`: `host` or `join`
    - `constraint`: `requirement` or `obligation`
    - `type`: abstraction/integer/string/boolean
    - optional commentary fields as needed by authors
  - `hostMacroTemplates`: ordered tokenized strings using `$TOPIC_n` (may be empty).
  - `joinMacroTemplates`: same structure for join (may be empty).

## Export to `.pspec`
- Export fails if any mode has an empty or whitespace-only `collaborationLabel`.
- Each topic in host/join requirements/obligations arrays contains:
  - `type` (from mode template).
  - `name` (the mode's `collaborationLabel`).
  - Type-specific property values (from `.pdes` topic instance).
- Every exported protocol also contains two implicit endpoints derived from its classification: a `<self>` host obligation and a `<self>` join requirement, both `abstraction` topics. These endpoints are not included in `$TOPICS`; `self` remains a fixed macro-wrapper parameter.
- Macro generation flow:
  - Build each side's `def` line by substituting `$TOPICS` with its side-local ordered identifiers.
  - Host/join macros: header → mode-contributed sub-statements → footer.

## Examples

Example `.pdd` (`docs/developer/diagnostics/examples/emergent-pdd-example-v1.pdd`):
```json
{
  "protocolDesignVersion": 1,
  "hostMacroGlobal": {
    "def": "def (acs, $TOPICS, self, trigger, debug_msg) :",
    "header": "sub /behaviour/add/collaboration-endpoint/host/x64@codevalley(acs, self, trigger, debug_msg) -> {",
    "footer": "}\nend"
  },
  "joinMacroGlobal": {
    "def": "def (acs, self, $TOPICS, trigger, debug_msg) :",
    "header": "sub /behaviour/add/collaboration-endpoint/join/x64@codevalley(acs, self, trigger, debug_msg) -> {",
    "footer": "}\nend"
  },
  "modeTemplates": [
    {
      "name": "collect-peer-sum-and-issue-offsets",
      "topics": [
        { "name": "first offset", "role": "host", "constraint": "requirement", "type": "integer", "comment": "first offset as dictated by the host" },
        { "name": "peer sum", "role": "host", "constraint": "obligation", "type": "integer", "comment": "sum of all peer quantity requests" },
        { "name": "requested quantity", "role": "join", "constraint": "requirement", "type": "integer", "comment": "quantity required by the peer" },
        { "name": "issued offset", "role": "join", "constraint": "obligation", "type": "integer", "comment": "offset issued from which the required quantity is available" }
      ],
      "hostMacroTemplates": [
        "sub /behaviour/collect-and-distribute/agent-integer/default/x64@codevalley(acs, $, $TOPIC_0, $TOPIC_1, trigger, debug_msg)"
      ],
      "joinMacroTemplates": [
        "sub /behaviour/fold-and-allocate/agent-integer/default/x64@codevalley(acs, $, $TOPIC_2, $TOPIC_3, trigger, debug_msg)"
      ]
    },
    {
      "name": "group-peers",
      "topics": [
        { "name": "hosted group", "role": "host", "constraint": "requirement", "type": "abstraction", "comment": "group dictated by host" },
        { "name": "joined group", "role": "join", "constraint": "obligation", "type": "abstraction", "comment": "group joined by peer" }
      ],
      "hostMacroTemplates": [
        "sub /behaviour/collect-and-distribute/agent-group/default/x64@codevalley(acs, $, $TOPIC_0, trigger, debug_msg)"
      ],
      "joinMacroTemplates": [
        "sub /behaviour/fold-and-allocate/agent-group/default/x64@codevalley(acs, $, $TOPIC_1, trigger, debug_msg)"
      ]
    }
  ]
}
```

Example `.pdes` (`docs/developer/diagnostics/examples/emergent-pdes-example-v1.pdes`):
```json
{
  "protocolDesignVersion": 1,
  "classification": "/data/example/default/x64",
  "description": "Minimal design to validate templates.",
  "policy": 0,
  "modes": [
    {
      "modeTemplate": "group-peers",
      "collaborationLabel": "Group peers",
      "topics": [
        {
          "name": "My number",
          "properties": { "protocol": "/data/integer/default/x64" }
        },
        {
          "name": "Hosts number",
          "properties": { "protocol": "/data/integer/default/x64" }
        }
      ]
    },
    {
      "modeTemplate": "collect-peer-sum-and-issue-offsets",
      "collaborationLabel": "Collect and issue offsets",
      "topics": [
        {
          "name": "Base",
          "properties": { "minimum": 1, "maximum": 1000, "hint": "1 - 100" }
        },
        {
          "name": "Total",
          "properties": { "minimum": 1, "maximum": 1000, "hint": "1 - 100" }
        },
        {
          "name": "Size",
          "properties": { "minimum": 1, "maximum": 1000, "hint": "1 - 100" }
        },
        {
          "name": "Offset",
          "properties": { "minimum": 1, "maximum": 1000, "hint": "1 - 100" }
        }
      ]
    }
  ]
}
```
