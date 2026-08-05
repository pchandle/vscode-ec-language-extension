# Troubleshooting

Start with **Emergent: Show Configuration Diagnostics**. It records the effective Studio endpoint, cache path, fetch controls, and relevant editor settings without exposing specification contents.

## Completions, hover, or specification lookup are unavailable

1. Confirm `studio.hostname`, `studio.port`, `studio.network`, and `studio.allowInsecure` in Configuration Diagnostics.
2. Ensure the Studio host is reachable from the VS Code extension host and that the HTTP/HTTPS choice matches the server.
3. Run **Emergent: Reload Specifications**. Use **Emergent: Clear Specification Cache** only when a reload does not resolve stale data.
4. Inspect **Output** → **Emergent Language Server**. Enable `emergent.trace.server` or `emergent.hoverDebugLogging` only while investigating.

`gateway.*` settings are ignored in 0.13.0 and later. Replace them with the matching `studio.*` settings.

## A local specification cannot be opened

Set `specification.localContractRoot` or `specification.localProtocolRoot` to the directory containing the relevant files. The command searches recursively for the configured filename template, offers a choice for duplicates, and offers creation when no match exists.

## A protocol design cannot be edited or exported

Make sure its `protocolDesignVersion` has a matching `.pdd` in `protocolDesign.activeDefinition`, `protocolDesign.definitionPaths`, or the bundled default definition. Resolve editor validation errors before exporting. Export also requires every mode to have a non-blank Collaboration label.

## Component Manager is empty or missing an item

Configure one or more folder URIs in `componentManager.componentDirectories`, then run **Emergent: Refresh Component Manager**. It indexes `.pdes`, `.pspec`, `.cspec`, and the configured autopilot extension only. Check the Component Manager Diagnostics section for duplicate definitions, missing contracts, or expression filename issues.

## Formatting changes less than expected

Formatting supports `.dla` and `.dlp`. Valid parsed structures receive syntax-aware indentation and selected structural cleanup; malformed regions use a conservative recovery mode to avoid destructive edits. Use **Format Document** for the full file or **Format Selection** for the selected lines.

## Bulk Expression Validation does not find files

Confirm `emergent.bulkValidationMode`, the autopilot/pilot extensions, and `emergent.bulkValidationFolders`. An empty folder list scans all workspace folders. Skipped findings are session-only; rescan after changing filters or fixing files.

## Reporting a problem

Include the Configuration Diagnostics report, relevant Language Server output, the extension and VS Code versions, and a minimal reproducible file where safe to share. Do not include credentials or private specification data. For vulnerabilities, follow the [security reporting policy](../developer/SECURITY.md).
