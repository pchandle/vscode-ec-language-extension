# Emergent Coding VS Code Extension User Guide

This guide explains how to use the extension in day-to-day workflows.

## 1. What This Extension Adds

The extension provides support for Emergent files:
- `.dla` (autopilot expressions)
- `.dlp` (pilot expressions)
- `.cspec` (contract specification)
- `.pspec` (protocol specification)
- `.pdes` (protocol design, edited through custom editor)

Core features:
- Syntax highlighting and Emergent snippets
- IntelliSense/completions for classification lines and suppliers
- Diagnostics from the language server
- Formatting for Emergent expressions
- Hover type information (optional)
- Specification lookup and local spec opening
- Contract/protocol design custom editors
- Bulk Expression Validation tree for workspace triage
- Component Manager relationship graph for managed component sources

## Component Manager

Component Manager is available from the Emergent Coding Activity Bar icon. Configure one or more folder URIs with `componentManager.componentDirectories`, then use **Emergent: Refresh Component Manager** when a manual scan is useful.

Select a protocol in the sidebar to open its design relationship map. The map shows direct `host`/`join` uses and lets you open the related job, contract topic, or protocol source beside it. Expanding or collapsing a job's Requirements or Obligations lane automatically reflows nearby cards to keep the map readable; use **Center graph** when you want to fit the changed map to the editor.

Use the collapsible **Search & filters**, **Protocols**, **Contracts**, and **Diagnostics** sections in Component Manager to focus the sidebar. The persistent search field has **Contracts** and **Protocols** checkboxes; **Used** is enabled by default and hides protocols with no direct `host` or `join` use. **Legacy** is disabled by default and includes protocols available only through a legacy `.pspec` file when enabled. The `ab` control enables whole-word matching and `.*` enables regular-expression matching. Diagnostics are kept in the final, initially collapsed section. Search only covers the configured component directories; it does not search the open workspace generally.

Managed `.pdes` files (with a matching `.pdd`) are the source of truth. Legacy `.pspec` files remain searchable and are marked **Legacy / published only** when no managed design exists. Component Manager never synchronises from `.pspec` publication.

Opening a protocol shows only its direct design uses in a compact, role-coloured map. Host-containing and join-only jobs occupy separate responsive regions; the selected protocol is named in the map header rather than repeated as a canvas node. A compact card shows only the topic bound through the protocol role's semantic `<self>` endpoint: host uses the job obligation and join uses the job requirement. A warning badge beside that topic indicates a live Emergent diagnostic on the associated `host` or `join` statement; hover the badge to read the message. Each lane heading shows its total topic count; expand a lane to inspect every contract topic. Lanes with no hidden topics have no expand control. **Center graph** resets the map’s pan and zoom, and **Show relationship list** provides the same information in a keyboard-friendly list. Selecting a job, contract topic, or protocol opens its source beside the map.

When a valid managed `.pdes` or resolved `.cspec` is saved, Component Manager can update matching *open* expression documents using undoable edits. It does not save expressions, and it does not change closed expression files. New collaboration topics may offer an explicit `join` or `host` insertion; accept the prompt to apply it.

## 2. First-Time Setup

1. Install **Emergent Coding** in VS Code.
2. Open a folder/workspace (recommended for full functionality).
3. Configure Studio connection in Settings:
- `studio.hostname`
- `studio.port`
- `studio.allowInsecure`
- `studio.network`

Optional but recommended for local spec workflows:
- `specification.localContractRoot`
- `specification.localProtocolRoot`
- `specification.defaultSupplier`

Helpful command for diagnostics:
- `Emergent: Show Configuration Diagnostics`

## 3. Workflow: Create a New Pilot/Autopilot Expression

There is no dedicated “new expression” command. Standard workflow is file creation + snippets.

1. Create a new file with extension:
- `.dla` for autopilot
- `.dlp` for pilot
2. Set language mode to **Emergent Coding** if VS Code does not auto-detect.
3. Start with defaults snippet:
- Type `defaults` and accept snippet.
- Example:

```emergent
defaults: behaviour, default, x64, codevalley
```

4. Add expression statements using snippets:
- `sub`
- `job`
- `host`
- `join`
- `if`
- `min` / `max` / `len`

5. Format file as needed:
- `Format Document`
- `Format Selection`

Formatting normalizes spacing (commas, `->`, repeated spaces, trailing spaces) and aligns standalone comments following completed multiline statements with their enclosing block.

## 4. Workflow: Write Spec-Aware Expressions with IntelliSense

When Studio specs are available, the extension can suggest statement content.

### 4.1 `sub` / `job` completions

- On lines beginning with `sub` or `job`, after opening `(`, IntelliSense can fill requirement/obligation names from the matching contract spec.

Example shape:

```emergent
sub /layer/verb/subject/variation/platform( ) ->
job /layer/verb/subject/variation/platform( ) :
```

### 4.2 `host` / `join` completions

- On `host` or `join` lines, IntelliSense can fill role topics from matching protocol specs.

### 4.3 Supplier completions and quick fixes

- On `sub ... @supplier`, IntelliSense suggests available suppliers.
- If a supplier is invalid, Quick Fix actions suggest replacements.
- Preferred quick fix prioritizes `specification.defaultSupplier` when available.

## 5. Workflow: Inspect a Referenced Specification from an Expression

Use this when your cursor is on a classification in `sub`, `job`, `host`, or `join`.

1. Put cursor on the classification text.
2. Run:
- `Emergent: Show Specification Panel`
3. Or use keybinding:
- `Ctrl+Alt+S` (`Cmd+Alt+S` on macOS)

Result:
- Opens/updates a side panel showing the resolved specification details.

You can also click classification links in Emergent documents (document links are provided by the extension).

## 6. Workflow: Open or Create a Local Spec from Expression Usage

Use this to jump from a classification in code to your local spec files.

1. Set roots in Settings:
- `specification.localContractRoot`
- `specification.localProtocolRoot`
2. Place cursor on classification in expression.
3. Run:
- `Emergent: Open Local Specification at Position`
4. Or use keybinding:
- `Ctrl+Alt+Shift+S` (`Cmd+Alt+Shift+S` on macOS)

Behavior:
- If one matching file exists: opens it.
- If multiple files match: prompts selection.
- If none exist: offers to create a spec template.

Filename is generated from classification using:
- `specification.contractFilenameFormat`
- `specification.protocolFilenameFormat`

## 7. Workflow: Create a New Contract Specification (`.cspec`)

1. Run `Emergent: New Contract Specification`.
2. Enter classification in required format:

```text
/layer/verb/subject/variation/platform
```

3. Choose save location.
4. The extension creates a template and opens it in the **Contract Specification Editor**.

Template includes:
- `type: "supplier"`
- `name` = classification
- `requirements`, `obligations`
- `supplier` initialized from `specification.defaultSupplier`

## 8. Workflow: Create Protocol Design (`.pdes`) and Export Protocol Spec (`.pspec`)

Important: `Emergent: New Protocol Specification` currently creates a **`.pdes` protocol design file**.

### 8.1 Create `.pdes`

1. Run `Emergent: New Protocol Specification`.
2. Enter classification format:

```text
/layer/subject/variation/platform
```

3. Save the generated `.pdes` file.
4. File opens in **Protocol Design Editor**.

Generated template includes:
- `protocolDesignVersion`
- `classification`
- `description`
- `policy`
- `modes`

### 8.2 Configure protocol design definitions (`.pdd`)

Used to drive version-aware design editing and transformation.

Settings:
- `protocolDesign.definitionPaths`
- `protocolDesign.activeDefinition`

Opening a `.pdd` file now uses the **Protocol Design Definition Editor** by default. The editor supports:
- editing host/join macro wrappers
- adding, renaming, reordering, and removing mode templates
- adding, reordering, and removing template topics
- guided insertion of `$TOPIC_n` tokens and common macro snippets

If no `.pdd` matches `protocolDesignVersion`, extension warns and can open raw text editor.

### 8.3 Export `.pdes` to `.pspec`

1. Open the target `.pdes`.
2. Run `Emergent: Export Protocol Spec (from .pdes)`.
3. Choose output path (`.pspec`).
4. If file exists, you can review diff before overwrite.

Each mode must have a non-empty **Collaboration label**. Export uses that label as the public name of every topic in the mode; it also creates the protocol's implicit `<self>` host/join endpoints.

### 8.4 Migrate a legacy `.pspec` to `.pdes`

Open the legacy `.pspec` in the Protocol Specification Editor and choose **Create `.pdes`**. The action is available only when a same-named `.pdes` file does not already exist in that directory; migration never overwrites an existing design.

The migration review selects a protocol design definition, proposes modes from the legacy topics and macros, and previews the new design. Review every inferred mode before creating the file. When a legacy mode used different topic names, choose its **Collaboration label** explicitly: a `.pdes` exports one public label for all topics in that mode. The original topic names remain as editor labels so that the migration can be reviewed and refined after opening the new design.

## 9. Workflow: Validate an Existing Workspace with Bulk Expression Validation

Use this for corpus-scale triage across many files.

1. Open Explorer view: **Bulk Expression Validation**.
2. Run `Emergent: Start Bulk Expression Validation`.
3. Navigate files via commands or toolbar:
- Start
- Rescan
- Next file
- Previous file
- Skip file
- Clear session

Default keybindings:
- `Ctrl+Alt+E Ctrl+F` start/focus
- `Ctrl+Alt+E Ctrl+N` next
- `Ctrl+Alt+E Ctrl+P` previous
- `Ctrl+Alt+E Ctrl+S` skip
- `Ctrl+Alt+E Ctrl+R` rescan

Behavior to know:
- Skip is session-only.
- Saving a file with no remaining Emergent diagnostics removes it from pending list.
- Tree groups files by classification-like segments for autopilot extension files.

Bulk scan settings:
- `emergent.bulkValidationMode` (`autopilot`, `pilot`, `both`)
- `emergent.autopilotExtension`
- `emergent.pilotExtension`
- `emergent.bulkValidationFolders`

## 10. Workflow: Refresh Spec Data and Cache

Commands:
- `Emergent: Reload Specifications`
- `Emergent: Clear Specification Cache`

Use when:
- New specs are available in Studio.
- Completions/lookup appear stale.

Cache/fetch controls:
- `emergent.specCache.softTtlHours`
- `emergent.specCache.fetchConcurrency`
- `emergent.specCache.retryCount`
- `emergent.specCache.retryBaseMs`
- `emergent.specCache.allowStale`
- `emergent.specCache.enableRootDocFallback`
- `emergent.specCache.requestTimeoutMs`
- `emergent.specCache.failureTtlMs`
- `emergent.specCache.rootRefreshMinutes`

## 11. Hover, Tracing, and Diagnostics Controls

Settings:
- `emergent.hover.disabled` (default is `true`)
- `emergent.hoverDebugLogging`
- `emergent.trace.server`
- `emergent.maxNumberOfProblems`

If hover is needed, set:

```json
"emergent.hover.disabled": false
```

## 12. Command Reference

### Specification and authoring
- `Emergent: Show Specification Panel`
- `Emergent: Open Specification at Position`
- `Emergent: Open Local Specification at Position`
- `Emergent: New Contract Specification`
- `Emergent: New Protocol Specification`
- `Emergent: Export Protocol Spec (from .pdes)`

### Runtime/spec maintenance
- `Emergent: Reload Specifications`
- `Emergent: Clear Specification Cache`
- `Emergent: Show Configuration Diagnostics`

### Bulk validation
- `Emergent: Start Bulk Expression Validation`
- `Emergent: Rescan Bulk Expression Validation`
- `Emergent: Next Bulk Expression File`
- `Emergent: Previous Bulk Expression File`
- `Emergent: Skip Bulk Expression File`
- `Emergent: Clear Bulk Expression Validation`

## 13. Known Limits and Practical Notes

- Protocol auto-completion may be incomplete in some scenarios.
- Studio connectivity and spec availability directly affect spec-aware completions.
- Deprecated `gateway.*` settings may still be read as fallback; migrate to `studio.*`.
- For language semantics, see `./emergent-coding-language.md`.
- For troubleshooting, see `./troubleshooting.md`.
