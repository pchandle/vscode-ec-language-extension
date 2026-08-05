# Configuration Guide

This guide lists every user-facing setting contributed by the extension.

## Studio connection

| Key | Default | Notes |
|---|---:|---|
| `studio.hostname` | `localhost` | Studio host used for specification fetches. |
| `studio.port` | `10000` | Studio TCP port. |
| `studio.allowInsecure` | `true` | Use HTTP when true and HTTPS when false. |
| `studio.network` | `31` | Fetch-path network: `31` or `34` (`34/36/37`). |

### Migrating from 0.12.x

Version 0.13.0 removes the legacy `gateway.*` settings. Replace each old key before upgrading:

| Removed key | Replacement |
|---|---|
| `gateway.hostname` | `studio.hostname` |
| `gateway.port` | `studio.port` |
| `gateway.allowInsecure` | `studio.allowInsecure` |
| `gateway.network` | `studio.network` |

Legacy keys are ignored by 0.13.0 and later.

## Specification fetch and cache

| Key | Default | Notes |
|---|---:|---|
| `emergent.specCache.softTtlHours` | `24` | Cache soft TTL in hours. |
| `emergent.specCache.fetchConcurrency` | `6` | Maximum in-flight fetches. |
| `emergent.specCache.retryCount` | `2` | Retries after the initial request. |
| `emergent.specCache.retryBaseMs` | `250` | Base retry backoff in milliseconds. |
| `emergent.specCache.allowStale` | `true` | Serve a stale payload while refreshing it. |
| `emergent.specCache.enableRootDocFallback` | `false` | Enable root-document host fallback after a direct Studio fetch fails. |
| `emergent.specCache.requestTimeoutMs` | `10000` | Per-request timeout in milliseconds. |
| `emergent.specCache.failureTtlMs` | `15000` | Cooldown before retrying a failed classification. |
| `emergent.specCache.rootRefreshMinutes` | `30` | Root-document refresh interval when fallback is enabled. |

## Specification authoring

| Key | Default | Notes |
|---|---|---|
| `specification.defaultSupplier` | `""` | Default supplier for new contract specifications. |
| `specification.localContractRoot` | `""` | Local root for `.cspec` lookup; accepts a filesystem path or file URI. |
| `specification.localProtocolRoot` | `""` | Local root for `.pspec` lookup; accepts a filesystem path or file URI. |
| `specification.contractFilenameFormat` | `{layer}--{verb}--{subject}--{variation}--{platform}` | Filename template for new contract specs. |
| `specification.protocolFilenameFormat` | `{layer}--{subject}--{variation}--{platform}` | Filename template for new protocol specs. |
| `specification.defaultContractExpressionPath` | `{layer}/{verb}/{subject}/{variation}/{platform}` | Relative Component Manager directory template for a new contract expression. |

Filename and path templates support the tokens shown in their defaults. The extension appends the relevant specification extension automatically.

## Editing and Component Manager

| Key | Default | Notes |
|---|---|---|
| `emergent.hover.disabled` | `true` | Disable Emergent hover popups. Set to `false` to enable them. |
| `protocolDesign.definitionPaths` | `[]` | Candidate `.pdd` files; relative paths use the first workspace folder. |
| `protocolDesign.activeDefinition` | `""` | Preferred `.pdd`; the bundled definition or the first valid candidate is used otherwise. |
| `componentManager.componentDirectories` | `[]` | Workspace-scoped folder URIs recursively indexed by Component Manager. Directories may be outside the workspace. |

Component Manager indexes `.pdes`, `.pspec`, `.cspec`, and files with `emergent.autopilotExtension`. It does not use `emergent.pilotExtension` or `emergent.bulkValidationMode`.

## Bulk validation

| Key | Default | Notes |
|---|---|---|
| `emergent.autopilotExtension` | `.dla` | Autopilot file extension; Component Manager also uses this value. |
| `emergent.pilotExtension` | `.dlp` | Pilot file extension. |
| `emergent.bulkValidationMode` | `autopilot` | Scan `autopilot`, `pilot`, or `both`. |
| `emergent.bulkValidationFolders` | `[]` | Workspace-relative folders to scan; empty means all workspace folders. |

## Diagnostics, tracing, and theme

| Key | Default | Notes |
|---|---:|---|
| `emergent.maxNumberOfProblems` | `100` | Maximum diagnostics returned by the language server. |
| `emergent.trace.server` | `verbose` | LSP trace level: `off`, `messages`, or `verbose`. |
| `emergent.hoverDebugLogging` | `false` | Extra hover/type logging in the Language Server output. |
| `emergent.themeReminder.enabled` | `true` | Show the one-time Design Domain Language theme reminder. |

## Configuration Diagnostics

Run **Emergent: Show Configuration Diagnostics** to open a report of effective Studio settings, cache settings and path, authoring settings, bulk-validation settings, and protocol-design settings.
