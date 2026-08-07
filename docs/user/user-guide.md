# Emergent Coding user guide

## Supported files and editors

| File | Purpose | Default editor |
|---|---|---|
| `.dla` | Autopilot expression | Emergent text editor |
| `.dlp` | Pilot expression | Emergent text editor |
| `.cspec` | Contract specification | Contract Specification Editor |
| `.pspec` | Protocol specification | Protocol Specification Editor |
| `.pdes` | Protocol design source | Protocol Design Editor |
| `.pdd` | Protocol design definition | Protocol Design Definition Editor |

The extension provides highlighting, snippets, diagnostics, completions, document links, specification lookup, local specification navigation, and formatting for Emergent expression files. The custom editors update the open document through VS Code edits; save the document with the normal VS Code save command.

When a specification is edited, integer `minimum`, `maximum`, and string `length` values are written as JSON strings. Valid protocol `policy` values are written as unquoted signed decimal JSON integers. Both forms preserve architecture-sized integers beyond JavaScript's safe-integer range.

## First-time setup

1. Open a folder or workspace.
2. Configure `studio.hostname`, `studio.port`, `studio.network`, and `studio.allowInsecure`.
3. Run **Emergent: Show Configuration Diagnostics** and resolve connection errors before relying on spec-aware features.
4. Optionally configure local specification roots, protocol design definitions, and Component Manager directories.

> **0.13.0 breaking change:** replace legacy `gateway.*` settings with the matching `studio.*` settings before upgrading. Legacy keys are ignored.

For all defaults and settings, see the [Configuration Guide](./configuration.md).

## Expression workflow

Create a `.dla` or `.dlp` file, then use the bundled `defaults`, `job`, `sub`, `host`, `join`, `if`, `min`, `max`, and `len` snippets. Use **Format Document** or **Format Selection** to apply spacing and syntax-aware layout to parsed structures. Formatting preserves uncertain comments and strings in malformed code.

When Studio specifications are available, completions can provide contract/protocol arguments and outputs. Supplier completion and quick fixes are available after `@` on a `sub` classification; `host` and `join` do not support supplier qualifiers.

## Specification lookup and authoring

Place the cursor on a `sub`, `job`, `host`, or `join` classification to inspect it:

- **Emergent: Show Specification Panel** opens a resolved specification beside the editor.
- **Emergent: Open Specification at Position** is the command target used by document links and can be invoked with a URI and position by integrations.
- **Emergent: Open Local Specification at Position** searches the configured local root. It opens one match, asks you to choose between duplicates, or offers to create a template when none exists.

Use **Emergent: New Contract Specification** to create a `.cspec`. It requests a five-segment contract classification and seeds the supplier from `specification.defaultSupplier`.

**Emergent: New Protocol Specification** creates a `.pdes` protocol design, despite its legacy command title. It requests a four-segment protocol classification, uses the highest available PDD version, and opens the Protocol Design Editor.

## Protocol designs and definitions

`.pdes` is the editable protocol-design source; `.pspec` is its exported protocol specification. Set `protocolDesign.definitionPaths` to provide workspace definitions and use `protocolDesign.activeDefinition` to prefer one. If no configured definition matches, the bundled PDD is considered.

Use **Emergent: Export Protocol Spec (from .pdes)** while a `.pdes` is active. Export validates the design and matching definition, requires every mode to have a non-blank Collaboration label, and lets you review an existing target before overwriting it.

Open a legacy `.pspec` in the Protocol Specification Editor and choose **Create `.pdes`** to start guided migration. The migration never overwrites an existing same-named design and requires review when mode selection, collaboration labels, macros, or topic interfaces cannot be inferred uniquely.

## Component Manager

Component Manager appears in the Emergent Coding Activity Bar. Configure `componentManager.componentDirectories`, then run **Emergent: Refresh Component Manager** after changing directories or when a full rescan is useful.

It recursively indexes `.pdes`, `.pspec`, `.cspec`, and files using `emergent.autopilotExtension`. It indexes source changes incrementally after the initial scan. Pilot files and Bulk Expression Validation filters do not affect it.

Use its search and filters to find contracts and protocols. A protocol row opens its relationship graph; contracts provide actions to edit their specification, select a matching expression when necessary, or create a starter expression when none is indexed. New expression paths use `specification.defaultContractExpressionPath`, `specification.contractFilenameFormat`, and `emergent.autopilotExtension`.

Graph source navigation reuses the active editor group. Ctrl-click on Windows/Linux or Cmd-click on macOS opens the source beside the graph. The graph shows direct `host` and `join` relationships derived from the protocol’s semantic `<self>` endpoint; it does not infer arbitrary local dataflow.

## Bulk Expression Validation

1. Open the **Bulk Expression Validation** Explorer view.
2. Run **Emergent: Start Bulk Expression Validation**.
3. Use the view toolbar or commands to rescan, move between files, skip a finding, and clear the session.

`Skip` is session-only. Saving a file after resolving its Emergent diagnostics updates the pending list. Configure the scan with `emergent.bulkValidationMode`, `emergent.autopilotExtension`, `emergent.pilotExtension`, and `emergent.bulkValidationFolders`.

## Cache, hover, and theme

- **Emergent: Reload Specifications** refreshes the specification cache.
- **Emergent: Clear Specification Cache** asks for confirmation before removing cached specifications.
- Set `emergent.hover.disabled` to `false` to enable type hover popups.
- Set `emergent.themeReminder.enabled` to `false` to suppress the one-time Design Domain Language theme suggestion.
- Use `emergent.trace.server` and `emergent.hoverDebugLogging` only while troubleshooting; inspect the Emergent Language Server output afterwards.

## Command reference

### Specification and protocol authoring

- **Emergent: Show Specification Panel**
- **Emergent: Open Specification at Position**
- **Emergent: Open Local Specification at Position**
- **Emergent: New Contract Specification**
- **Emergent: New Protocol Specification**
- **Emergent: Export Protocol Spec (from .pdes)**

### Runtime and diagnostics

- **Emergent: Reload Specifications**
- **Emergent: Clear Specification Cache**
- **Emergent: Show Configuration Diagnostics**

### Bulk Expression Validation

- **Emergent: Start Bulk Expression Validation**
- **Emergent: Rescan Bulk Expression Validation**
- **Emergent: Next Bulk Expression File**
- **Emergent: Previous Bulk Expression File**
- **Emergent: Skip Bulk Expression File**
- **Emergent: Clear Bulk Expression Validation**
- **Emergent: Focus Bulk Expression Validation**

### Component Manager

- **Emergent: Refresh Component Manager**
- **Emergent: Open Component Manager Graph**
- **Emergent: Open Component Manager Source**

The final two commands are used by Component Manager interactions and integrations; normal use starts from the Component Manager view.

## Keybindings

| Command | Windows/Linux | macOS |
|---|---|---|
| Show Specification Panel | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| Open Local Specification at Position | `Ctrl+Alt+Shift+S` | `Cmd+Alt+Shift+S` |
| Start/Focus Bulk Expression Validation | `Ctrl+Alt+E Ctrl+F` | `Cmd+Alt+E Cmd+F` |
| Next Bulk Expression File | `Ctrl+Alt+E Ctrl+N` | `Cmd+Alt+E Cmd+N` |
| Previous Bulk Expression File | `Ctrl+Alt+E Ctrl+P` | `Cmd+Alt+E Cmd+P` |
| Skip Bulk Expression File | `Ctrl+Alt+E Ctrl+S` | `Cmd+Alt+E Cmd+S` |
| Rescan Bulk Expression Validation | `Ctrl+Alt+E Ctrl+R` | `Cmd+Alt+E Cmd+R` |

See [Troubleshooting](./troubleshooting.md) for recovery steps and the [extension language guide](./emergent-coding-language.md) for supported expression syntax.
