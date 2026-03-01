# Emergent Coding for Visual Studio Code

This extension provides rich Emergent Coding language support for Visual Studio Code ([VS Code](https://github.com/Microsoft/vscode)). Now you can write and debug Emergent Coding expressions using the excellent IDE-like interface that VS Code provides.

# Features
- Syntax highlighting
- Code snippets
- IntelliSense for contract specifications, protocol specifications and more
- Bulk Expression Validation for workspace-wide diagnostics triage

# Bulk Expression Validation
Bulk Expression Validation lets you recursively scan workspace folders for Emergent diagnostics and work through them in a dedicated tree view.

## How to start
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run `Emergent: Start Bulk Expression Validation`.
3. Use the `Bulk Expression Validation` view in Explorer to click through diagnostics and jump directly to file locations.

## Commands
- `Emergent: Start Bulk Expression Validation`
- `Emergent: Rescan Bulk Expression Validation`
- `Emergent: Next Bulk Expression File`
- `Emergent: Previous Bulk Expression File`
- `Emergent: Skip Bulk Expression File`
- `Emergent: Clear Bulk Expression Validation`

## Default keybindings
- `Ctrl+Alt+E Ctrl+F`: Start/Focus Bulk Expression Validation
- `Ctrl+Alt+E Ctrl+N`: Next diagnostic
- `Ctrl+Alt+E Ctrl+P`: Previous diagnostic
- `Ctrl+Alt+E Ctrl+S`: Skip diagnostic (session-only)
- `Ctrl+Alt+E Ctrl+R`: Rescan

## Configuration
Key settings are grouped as follows:

| Group | Key Prefix | Purpose |
|---|---|---|
| Studio Connection | `studio.*` | Configure Studio endpoint and network |
| Specification Fetch & Cache | `emergent.specCache.*` | Runtime fetch/cache behavior (TTL, retry, timeout, fallback) |
| Specification Authoring | `specification.*` | Local roots, filename templates, default supplier |
| Hover | `emergent.hover.*` | Enable/disable hover |
| Bulk Validation | `emergent.autopilotExtension`, `emergent.pilotExtension`, `emergent.bulkValidation*` | Corpus scan behavior |
| Protocol Design | `protocolDesign.*` | `.pdd` selection and override |
| Diagnostics & Tracing | `emergent.maxNumberOfProblems`, `emergent.trace.server`, `emergent.hoverDebugLogging` | Diagnostic volume and logging |

Legacy `gateway.*` settings are deprecated, auto-migrated when possible, and planned for removal in `0.12.0`.

For detailed defaults, behavior notes, and migration guidance, see [Configuration Guide](./docs/configuration.md).

## Additional Commands
- `Emergent: Show Configuration Diagnostics` (opens a report of effective configuration values and runtime paths)

## Notes
- Bulk Expression Validation results coexist with live language-server diagnostics.
- `Skip` is temporary and only applies to the current session.
- Saving a file after a fix automatically marks matching items as resolved and advances to the next pending item.

# Installing the Extension
You can install the official release of the Emergent Coding extension by following the steps in the [Visual Studio Code documentation](https://code.visualstudio.com/docs/editor/extension-marketplace). In the Extensions pane, search for "Emergent Coding" extension and install it there. You will get notified automatically about any future extension updates!

# Reporting Problems
If you experience any problems with the Emergent Coding Extension, see the [troubleshooting docs](https://github.com/aptissio/vscode-ec-language-extension/blob/main/docs/troubleshooting.md) for information on diagnosing and reporting issues.

# Contributing to the Code
Check out the [development documentation](https://github.com/aptissio/vscode-ec-language-extension/blob/main/docs/development.md) for more details on how to contribute to this extension!

# License
This extension is licensed under the [MIT License](https://github.com/aptissio/vscode-ec-language-extension/blob/main/LICENSE). Please see the [third-party notices](https://github.com/aptissio/vscode-ec-language-extension/blob/main/third-party-notices.md) file for details on the third-party binaries that we include with releases of this project.
