# Component Manager V1 Requirements

## Purpose

Component Manager is an Emergent Coding Activity Bar feature for navigating,
visualising, and safely synchronising the relationship between contract
specifications, protocol designs, and autopilot expression `job` blocks.

It is not a replacement for the existing editors. The Component Manager graph
is a navigation and change-orchestration surface; authors continue to edit:

- `.cspec` files in the Contract Specification Editor;
- `.pdes` files in the Protocol Design Editor; and
- autopilot expression files in the normal text editor.

The V1 graph is read-only except for explicit, offered source edits. It must
never make runtime-connectivity claims from static source alone.

## V1 outcome

An author can select a protocol, see all open job blocks that directly use it,
navigate to the exact source topic or statement, and keep open expressions in
step with saved protocol-design and contract-specification changes.

## Source and publication model

| Artefact | V1 role |
|---|---|
| `.pdes` + matching `.pdd` | Authoritative managed protocol source. A saved, valid design is transformed to obtain the interface used by Component Manager. |
| `.pspec` | Published/legacy protocol artefact. It is searchable and viewable only when no managed `.pdes` source exists. It is not synchronised. |
| `.cspec` | Authoritative contract specification used to synchronise its matching job header. |
| Configured autopilot expression | Source containing one or more `job` blocks, `host` statements, and `join` statements. |

Editing a legacy `.pspec` and migrating it to `.pdes` is a manual process in
V1. A future guided migration workflow is out of scope.

## Component directories and indexing

`componentManager.componentDirectories` is a workspace-scoped list of VS Code
folder URIs. Directories may be outside the workspace.

The manager recursively indexes:

- managed `.pdes` sources;
- legacy `.pspec` files;
- `.cspec` contract specifications; and
- files with the configured `emergent.autopilotExtension` (default `.dla`).

Pilot files and `emergent.bulkValidationMode` are unrelated to Component
Manager and must not affect its index.

The index refreshes automatically after relevant saves, file creations, and
file deletions within component directories. A **Refresh Component Manager**
command provides a manual fallback.

### File and classification diagnostics

- Duplicate managed `.pdes` definitions for one protocol classification are a
  Component Manager error. Show every conflicting source as a link, and block
  protocol generation/synchronisation until resolved.
- A `.pspec` with no corresponding `.pdes` is searchable but visibly marked
  **Legacy / published only**.
- Missing or duplicate `.cspec` definitions for a job classification are
  resolution diagnostics. For a missing definition, link to the expression
  file's containing folder; for duplicates, link to each definition. Contract
  synchronisation is disabled for that job.
- Each autopilot expression file is expected to contain one `job` block. A
  file with no job or more than one job receives a diagnostic, but the manager
  still renders one graph node per parsed job block.
- When exactly one job is present, the filename must equal the job
  classification rendered with `specification.contractFilenameFormat`, plus
  `emergent.autopilotExtension`. A mismatch is a diagnostic. Filename is a
  clue only; parsed job classifications remain authoritative.

## Component identity and graph scope

A graph node represents an individual `job` block. Multiple job blocks from a
single file remain separate nodes and are grouped by their expression file.

The graph canvas shows all open autopilot job nodes. Selecting a protocol
highlights direct uses of that protocol; jobs with no direct use remain visible
but muted. The graph does not need an explanatory label on every muted node.

### Direct relationship rule

A line is shown only for the semantic collaboration `<self>` endpoint of a
selected managed protocol. A `join` statement contributes the label at the
unique `<self>` slot in join requirements and matches it only to the job's
requirement header; a `host` statement does the same from host obligations to
the job's obligation header. Other role labels are not graph relationships.
Missing, invalid, out-of-range, or ambiguous self labels produce no line; V1
does not infer dataflow through local statements, functions, or macros.

Each job node has **Requirements** and **Obligations** groups. In compact
form, a group shows only its self-bound topic; expanding it reveals the
remaining contract topics. A group without hidden topics is a static label,
not an inactive expand/collapse control. Protocol lines terminate at the exact
self-bound topic row.

## Component Manager user interface

The Activity Bar icon opens the Component Manager sidebar. The sidebar
contains protocol search, protocol usage counts, resolution diagnostics, and
component directory status.

Opening a protocol opens a full editor-area Component Manager graph tab. The
graph uses React Flow (`@xyflow/react`) for node layout, selectable rows,
topic-level edges, zoom, fit-to-view, and minimap controls. It is a view, not
a graph editor.

Navigation is source-specific:

| Selection | Result |
|---|---|
| Job node or current job label | Focus the `.dla` editor and reveal the job block/label. |
| Contract topic | Open/focus the matching `.cspec` in the Contract Specification Editor. |
| Managed protocol or protocol topic | Open/focus the matching `.pdes` in the Protocol Design Editor. |
| Legacy protocol | Open the `.pspec` in the existing specification editor, marked legacy/published-only. |

By default, source navigation reuses the active editor group. Ctrl-click on
Windows/Linux or Cmd-click on macOS opens the source beside the graph when the
relationship context should remain visible.

## Protocol participation semantics

For a selected protocol, `host` selects its `host` interface and `join`
selects its `join` interface. Arguments bind in order to requirements; labels
after `->` bind in order to obligations.

Component Manager preserves existing source labels. It generates a new label
as the normalised topic name, lower-case snake_case, adding `_2`, `_3`, and so
on only to avoid a collision.

### Managed protocol synchronisation

A protocol synchronisation begins only after a valid `.pdes` save can be
transformed with its matching `.pdd`. Publishing/exporting `.pspec` is not a
second synchronisation trigger.

For each affected open expression statement, evaluate changes separately for
host requirements, host obligations, join requirements, and join obligations:

1. Retain labels for existing topics, including in-place topic name/type
   changes.
2. Add labels for inserted topics only.
3. Move labels with their topics when protocol topics are reordered.
4. Remove labels for deleted topics only after all additions and moves have
   succeeded.

The update applies to open expressions even when they contain unsaved edits.
It is an undoable workspace/editor change and leaves every expression dirty;
Component Manager never silently saves it or opens/changes a closed expression.

If old/new topic mapping is ambiguous, Component Manager raises a diagnostic
with links to the protocol and affected expressions, makes no automatic change
for that role lane, and resumes only after the ambiguity is resolved.

### Collaboration self topic

Managed protocol export derives an interface topic named `<self>` from the
protocol design classification. Component Manager recognises a self topic only
when it is a unique `abstraction` topic whose `protocol` equals the selected
protocol classification. It does not depend on a fixed array ordinal.

This is the bridge between a collaboration topic in a contract and a protocol
participation statement:

- `join` binds the contract requirement label at the discovered self topic in
  join requirements.
- `host` binds the contract obligation label at the discovered self topic in
  host obligations.

All non-self protocol labels are generated using the normal topic-label rule.
If the required self topic is missing, duplicated, incorrectly typed, or names
a different protocol, Component Manager does not offer statement generation.

## Contract specification synchronisation

A job is associated with a contract specification by normalised job
classification. After saving a resolved `.cspec`, Component Manager updates
the matching open job headers using the same label lifecycle as protocol
synchronisation: retain, insert, move, then remove; stop and alert on
ambiguous mapping; leave documents open, undoable, and unsaved.

When a newly added contract topic is an `abstraction` with a `protocol`
classification, Component Manager offers an explicit source edit:

| Added contract topic | Offered statement |
|---|---|
| Requirement collaboration | `join` for the nominated protocol. |
| Obligation collaboration | `host` for the nominated protocol. |

When accepted, the statement is inserted as the first statement inside the
complete `job` body, after the full (possibly multi-line) header and `:`.
The contract topic's generated job label occupies the protocol role's semantic
`<self>` slot; other role labels are generated from their protocol topics.

The offer is unavailable when the nominated protocol cannot be resolved, is
legacy-only, is ambiguous, or has no valid self-topic mapping.

## Non-functional requirements

- Use parser/resolver/type-checker and protocol transformation output as the
  source of truth; do not re-parse source with regular expressions.
- Display all resolution, syntax, arity, type, and mapping-ambiguity states
  using text as well as colour.
- Provide keyboard operation and an accessible list/tree alternative to the
  graph canvas.
- Follow VS Code light, dark, and high-contrast themes.
- Render partial results with explicit causes; do not invent missing interfaces
  or runtime participant relationships.

## Explicit V1 exclusions

- Runtime connection/session topology.
- Indirect local dataflow tracing.
- Pilot-expression indexing.
- Guided `.pspec` to `.pdes` migration.
- Graph-source editing, persisted graph layout, and automatic saving of source.
- Automatic changes to closed expressions.
