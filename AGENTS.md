# AGENTS.md

Guidance for coding agents working in `vscode-ec-language-extension`.

## Project Summary
- VS Code extension for the Emergent Coding language.
- Monorepo layout with separate client/server TypeScript code and a React webview.
- Root package orchestrates build/test/lint across subprojects.

## Repository Layout
- `client/src`: VS Code extension host code (activation, commands, custom editors).
- `server/src`: language server (lexer/parser/resolver/type checker/diagnostics).
- `server/test`: server unit/perf tests.
- `webview-src`: React webview sources for spec editors.
- `media`: generated webview bundle + copied schemas.
- `docs`: specs, examples, security and troubleshooting docs.
- `scripts`: build, validation, and test helper scripts.

## Environment
- Node.js + npm required.
- Install dependencies at repo root first:
  - `npm install`
- Root `postinstall` installs `client` and `server` dependencies automatically.

## Common Commands
- Build everything: `npm run build`
- Bundle only extension/server: `npm run bundle`
- Build webview bundle + generated validators: `npm run build:webview`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Compile VS Code integration test TS: `npm run test:compile-client`
- VS Code e2e tests: `npm test`
- Server-only tests (offline): `npm run test:server`
- Validator generation check: `npm run test:validators`

## Agent Workflow
1. Read `package.json` scripts and relevant docs before editing.
2. Keep changes scoped to the requested area (client/server/webview/docs).
3. After edits, run the narrowest valid checks first, then broader checks:
   - Prefer targeted test(s) for changed code.
   - Run `npm run typecheck` and `npm run lint` before finalizing.
4. If schema or webview form behavior changes, run `npm run build:webview` and confirm generated validators in `webview-src/generated` are updated.
5. For parser/resolver/type checker changes, run `npm run test:server`.

## Testing Notes
- `npm test` runs `bash ./scripts/e2e.sh`, not `sh`, because the script uses bash features (`pipefail`, process substitution).
- `scripts/e2e.sh` compiles client tests before execution (`npm run --silent test:compile-client`), so new files under `client/src/test` are picked up automatically.
- `scripts/e2e.sh` filters known Electron/Linux noise lines (DBus/GPU/deprecation) from stderr; real test failures are still surfaced.
- If `.vscode-test/...` is missing, `npm test` may attempt to download VS Code from `update.code.visualstudio.com` and fail in restricted network environments.
- Current integration baseline is 3 active tests in `client/src/test`: completion, diagnostics, formatting.
- `npm run test:server` is currently green (58 passing) after fixing test fixture paths and outdated expectations.
- For repeated corpus-scale diagnostics validation, follow `docs/diagnostics-validation-playbook.md`.
- Local-only diagnostics workspace: `/.ops/diagnostics-lab/` (git-excluded via `.git/info/exclude`).
- Corpus workflow commands:
  - `npm run validate:corpus`
  - `npm run validate:corpus:baseline`
  - `npm run triage:diagnostics`
  - `npm run triage:report`

## Code Style and Safety
- TypeScript is primary language; preserve existing module and build patterns.
- Do not hand-edit generated outputs unless explicitly requested:
  - `media/main.js`
  - `webview-src/generated/*Validator.ts`
- Avoid broad refactors unless required by the task.
- Keep diagnostics behavior stable; include tests when changing language semantics.

## Security and Disclosure
- Follow `docs/SECURITY.md` for vulnerability reporting.
- Do not expose potential vulnerabilities in public issue text; direct reports to the documented security contact.

## High-Value Validation Targets
- Parser/lexer behavior: `server/test/parser.test.ts`
- Name resolution/type checking: `server/test/resolver.test.ts`, `server/test/typeChecker.test.ts`
- Completion behavior: `server/test/completionSupport.test.ts`
- Extension integration tests: `client/src/test/*`

## When Unsure
- Prefer small, testable edits.
- Surface assumptions explicitly in your final summary.
- If command results conflict with docs, trust executable scripts and report the discrepancy.
