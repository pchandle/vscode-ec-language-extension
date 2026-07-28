# Development Instructions for the Emergent Coding Extension
## Development Setup
1. Fork and clone the [vscode-ec-language-extension](https://github.com/aptissio/vscode-ec-language-extension) repository.
1. Install [Node.js](https://nodejs.org/en/) 18.x or higher.

## Diagnostics Validation at Scale
For corpus-scale diagnostics validation and fast triage workflow, see:
- [Diagnostics Validation Playbook](./diagnostics/diagnostics-validation-playbook.md)

## Building the Code
## Launching the Extension

## Integration Tests

`npm test` runs VS Code integration tests with a fresh temporary VS Code profile for each run. Set `EMERGENT_E2E_TIMEOUT_MS` to change the default 10-minute shutdown timeout. Failed or timed-out runs print the retained temporary profile path so their VS Code logs can be inspected.

## Contributing Snippets
For more information on contributing snippets please read our [snippet requirements](https://github.com/aptissio/vscode-ec-language-extension/blob/main/docs/developer/community_snippets.md#contributing).

## Contribution Checklist
- [ ] Updated user documentation for user-visible behavior changes (`docs/user/user-guide.md`, `docs/user/configuration.md`, or `docs/user/troubleshooting.md`).
