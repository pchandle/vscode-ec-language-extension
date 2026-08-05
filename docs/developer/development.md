# Developing the Emergent Coding extension

## Setup

Install Node.js 18 or later, clone the repository, and install dependencies from the repository root:

```bash
npm install
```

The root post-install step installs the client and server dependencies. Work from the root so the extension manifest, client bundle, server bundle, and webview remain coordinated.

## Architecture

- `client/src` contains extension-host activation, commands, custom editors, bulk validation, and Component Manager.
- `server/src` contains the language server, lexer/parser, resolver/type checker, formatting, and Studio specification cache client.
- `webview-src` contains the React views used by the specification editors and Component Manager.
- `conf` contains the language grammar, snippets, and theme.
- `docs/developer/spec.schema.json` and `docs/developer/pdd.schema.json` are source schemas. `npm run build:webview` copies schemas into `media` and regenerates webview validators.

Studio configuration is the only supported connection interface. Do not add `gateway.*` fallback behaviour.

## Development loop

| Goal | Command |
|---|---|
| Build all shipped bundles | `npm run build` |
| Build webview and generated validators | `npm run build:webview` |
| Watch client/server bundles | `npm run watch:client` / `npm run watch:server` |
| Watch webview bundle | `npm run watch:webview` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Server tests | `npm run test:server` |
| VS Code integration tests | `npm test` |
| Documentation checks | `npm run test:docs` |

After the final edit to runtime source, configuration, or webview source, run `npm run build` before testing or handoff. Do not hand-edit `media/main.js` or `webview-src/generated/*Validator.ts`.

## Testing guidance

- Parser, resolver, type-checker, completion, and formatter changes require `npm run test:server`.
- Schema or webview form changes require `npm run build:webview` and `npm run test:validators`.
- Custom editor synchronization changes require `npm run test:custom-editor-sync`.
- Extension-host behaviour requires `npm test` when the VS Code runtime is available. The test script uses an isolated profile and may need a cached/downloadable VS Code build.
- Corpus-scale diagnostics and formatter validation use the repository-local `.ops/diagnostics-lab` workflow; see the linked playbooks below.

## Debugging

Use **Emergent: Show Configuration Diagnostics** to inspect effective Studio and cache settings. Inspect **Output** → **Emergent Language Server** for server logs. Use `emergent.trace.server` and `emergent.hoverDebugLogging` temporarily, then return them to their defaults.

- [Diagnostics Validation Playbook](./diagnostics/diagnostics-validation-playbook.md)
- [Formatter Corpus Validation](./formatting-validation.md)
- [Snippet contribution guidance](./community_snippets.md)

## Release preflight

1. Update the root package version, root lockfile, and `CHANGELOG.md` together.
2. Run `npm run build`, `npm run test:docs`, `npm run test:validators`, `npm run test:custom-editor-sync`, `npm run test:server`, `npm run typecheck`, `npm run lint`, and `npm test` where supported.
3. Inspect `npx --no-install @vscode/vsce ls`; verify it includes only intended runtime assets, user documentation, licence/notices, schemas, and PDD resources.
4. Verify external documentation links and third-party notices before publishing the VSIX.
