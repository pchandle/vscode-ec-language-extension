# Component Manager implementation contract

Component Manager indexes configured component directories and provides navigation, diagnostics, and direct protocol relationship views. It complements the specification and text editors; it is not a graph editor or a runtime topology view.

## Indexed sources

`componentManager.componentDirectories` accepts workspace-scoped folder URIs, including directories outside the workspace. Component Manager recursively indexes `.pdes`, `.pspec`, `.cspec`, and files matching `emergent.autopilotExtension`. It ignores pilot files and Bulk Expression Validation filters.

Initial activation, directory/configuration changes, and **Refresh Component Manager** perform a full scan. Relevant file changes are batched and indexed incrementally.

`.pdes` plus its resolved `.pdd` is authoritative for a managed protocol interface. A `.pspec` without a matching design remains searchable as **Spec-only** and is not synchronized. Contract specifications resolve job headers by normalized classification.

## Diagnostics and navigation

The manager reports duplicate protocol designs, unresolved/duplicate contracts, expression files with zero or multiple jobs, and filename mismatches. Parsed classifications remain authoritative over filenames.

Selecting a protocol opens a graph of its direct `host` and `join` relationships. Lines use only the selected role’s unique semantic `<self>` endpoint; Component Manager does not infer arbitrary local dataflow. Source actions open in the active editor group; Ctrl-click/Cmd-click opens beside.

## Synchronisation boundaries

Saving a valid resolved `.pdes` or `.cspec` can update matching **open** expressions through undoable edits. Component Manager never saves changed expressions and never changes closed expressions. Ambiguous mappings produce diagnostics instead of automatic edits.

When a newly added contract collaboration topic resolves to a valid managed protocol, Component Manager can offer an explicit `join` or `host` insertion. New expression creation uses the configured directory/filename templates.
