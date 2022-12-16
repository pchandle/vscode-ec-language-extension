# Troubleshooting Emergent Coding Extension Issues
This document contains troubleshooting steps for commonly reported issues when using the [Emergent Coding](https://github.com/aptissio/vscode-ec-language-extension) Extension for Visual Studio Code.

## Completions aren't appearing
The extension relies upon indexing specification data from the Valley using a Gateway server. Please make sure you have configured the extension to your local Gateway server. The indexing of specifications may take several minutes to complete.

## Known issues with the extension
- Protocol auto-completion doesn't work properly.