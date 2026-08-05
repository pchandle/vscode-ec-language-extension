# Emergent Coding for Visual Studio Code

Emergent Coding provides editing support for Emergent expressions and specifications in Visual Studio Code.

## Quick start

1. Install the **Emergent Coding** extension from the [VS Code Extension Marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace).
2. Open an Emergent workspace and configure `studio.hostname`, `studio.port`, `studio.network`, and `studio.allowInsecure`.
3. Run **Emergent: Show Configuration Diagnostics** to confirm the effective connection and cache settings.

> **0.13.0 breaking change:** `gateway.*` settings are no longer supported. Replace `gateway.hostname`, `gateway.port`, `gateway.network`, and `gateway.allowInsecure` with their `studio.*` equivalents before upgrading.

## Features

- Syntax highlighting, snippets, diagnostics, completions, document links, and hover type information for Emergent expressions.
- Document and range formatting for `.dla` and `.dlp` files, including syntax-aware indentation for valid structures and conservative recovery for malformed input.
- Specification lookup, local specification navigation, supplier completions, and supplier quick fixes.
- Custom editors for contract specifications (`.cspec`), protocol specifications (`.pspec`), protocol designs (`.pdes`), and protocol design definitions (`.pdd`).
- Protocol-design export and guided legacy `.pspec` to `.pdes` migration.
- Bulk Expression Validation for workspace diagnostics triage.
- Component Manager for indexing configured component directories, finding contracts/protocols, and viewing direct protocol relationships.

## Documentation

User documentation:

- [User guide](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/user/user-guide.md)
- [Configuration guide](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/user/configuration.md)
- [Troubleshooting](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/user/troubleshooting.md)
- [Extension language guide](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/user/emergent-coding-language.md)

Developer documentation:

- [Development guide](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/developer/development.md)
- [Security reporting](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/developer/SECURITY.md)
- [Diagnostics validation playbook](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/developer/diagnostics/diagnostics-validation-playbook.md)
- [Formatter corpus validation](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/developer/formatting-validation.md)

## Release and support

- Review [CHANGELOG.md](https://github.com/pchandle/vscode-ec-language-extension/blob/main/CHANGELOG.md) for release notes.
- Report non-security problems through the project repository.
- Do not report security vulnerabilities publicly; follow the [security reporting policy](https://github.com/pchandle/vscode-ec-language-extension/blob/main/docs/developer/SECURITY.md).

## Licence

This extension is licensed under the [MIT License](https://github.com/pchandle/vscode-ec-language-extension/blob/main/LICENSE). See [third-party notices](https://github.com/pchandle/vscode-ec-language-extension/blob/main/third-party-notices.md) for shipped dependency notices.
