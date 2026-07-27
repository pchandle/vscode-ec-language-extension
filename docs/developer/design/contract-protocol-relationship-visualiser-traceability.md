# Component Manager V1: Traceability and Acceptance

## Authoritative inputs

| Component Manager fact | Authority |
|---|---|
| Job block and its labels | Parsed autopilot expression. |
| Contract interface and topic order | Resolved `.cspec`. |
| Managed protocol interface | Valid `.pdes` transformed with its matching `.pdd`. |
| Legacy protocol interface | `.pspec`, only where a managed `.pdes` source is absent. |
| `host`/`join` binding | Selected role interface and positional arguments/outputs. |
| Collaboration self binding | Unique `<self>` abstraction interface topic for the protocol's own classification. |
| Normalised classification and semantic diagnostics | Existing language service. |
| Filename expectation | `specification.contractFilenameFormat` plus `emergent.autopilotExtension`. |

## Acceptance scenarios

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | A component directory containing one valid `.pdes`, matching `.pdd`, `.cspec`, and `.dla` | Index completes | The protocol, contract, and parsed job appear in Component Manager. |
| AC-02 | A `.pspec` with no same-classification `.pdes` | It is indexed | It is searchable and visibly legacy; no synchronisation is offered. |
| AC-03 | Two `.pdes` files share a classification | Index completes | A duplicate-protocol error links both files and blocks managed protocol updates. |
| AC-04 | A `.dla` has exactly one job but a nonconforming filename | Index completes | A filename diagnostic reports the expected configured-format filename. |
| AC-05 | A `.dla` has more than one job | Index completes | Each job is rendered as a node, grouped by file, and the file receives a structural diagnostic. |
| AC-06 | A selected managed protocol is used by two open jobs through valid self slots | User opens its graph | Lines terminate only on the matching job topic labels selected by the role's semantic `<self>` slot; non-self labels are not highlighted or wired. |
| AC-07 | A job's matching `.cspec` is missing | Job is indexed | The diagnostic links to the expression folder and contract synchronisation is disabled. |
| AC-08 | A valid managed protocol adds a role topic | Its `.pdes` is saved | Each matching open statement receives only the newly generated label and remains unsaved/undoable. |
| AC-09 | A managed protocol reorders topics | Its `.pdes` is saved | Existing labels move with the matched topics. |
| AC-10 | A role-topic mapping is ambiguous | A protocol or contract synchronisation is attempted | The affected lane is unchanged and a diagnostic links to source and expressions. |
| AC-11 | A contract requirement collaboration is added | Its `.cspec` is saved and the user accepts the offer | A `join` statement is inserted first inside the job body; the new job label occupies the protocol join self slot. |
| AC-12 | A contract obligation collaboration is added | Its `.cspec` is saved and the user accepts the offer | A `host` statement is inserted first inside the job body; the new job label occupies the protocol host self slot. |
| AC-13 | A self topic is absent or invalid | A collaboration offer would be shown | The offer is unavailable and explains the invalid self mapping. |
| AC-14 | A job-node, contract-topic, or managed-protocol selection | The user activates it | The `.dla`, `.cspec` custom editor, or `.pdes` custom editor respectively opens beside the graph and reveals the source. |
| AC-15 | An open expression has unsaved edits | A valid synchronisation occurs | The update applies as an undoable edit and does not save the expression. |

## Implementation boundaries

- Component Manager must use a renderer-neutral projection between extension
  host/language service and React Flow webview.
- The graph must carry URI/range source references for every selectable node,
  topic, and diagnostic.
- Directory scanning must use the configured autopilot extension only.
- The `.pdes` transform must be treated as the managed protocol interface
  authority, including its derived `<self>` topics and macro mapping.
- No Component Manager rule may rely on `self` being at a fixed position;
  resolve the semantic `<self>` topic instead.
