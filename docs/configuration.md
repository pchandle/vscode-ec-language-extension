# Configuration Guide

This guide explains all user-facing configuration keys, their defaults, and when they are relevant.

## Studio Connection

| Key | Default | Notes |
|---|---|---|
| `studio.hostname` | `localhost` | Studio host used by runtime fetches. |
| `studio.port` | `10000` | Studio port. |
| `studio.allowInsecure` | `true` | Uses `http` when true, `https` when false. |
| `studio.network` | `31` | Selects fetch path prefix strategy (`31` or `34`). |

## Specification Fetch & Cache

| Key | Default | Notes |
|---|---|---|
| `emergent.specCache.softTtlHours` | `24` | Cache soft TTL in hours. |
| `emergent.specCache.fetchConcurrency` | `6` | Maximum in-flight spec fetch requests. |
| `emergent.specCache.retryCount` | `2` | Retries after the initial request. |
| `emergent.specCache.retryBaseMs` | `250` | Base retry backoff in milliseconds. |
| `emergent.specCache.allowStale` | `true` | Serve stale cached payloads while refresh runs. |
| `emergent.specCache.enableRootDocFallback` | `false` | Enables root-doc host fallback when direct Studio fetch fails. |
| `emergent.specCache.requestTimeoutMs` | `10000` | Per-request timeout in milliseconds. |
| `emergent.specCache.failureTtlMs` | `15000` | Cooldown in milliseconds before retrying a recent failed classification. |
| `emergent.specCache.rootRefreshMinutes` | `30` | Root-doc refresh cadence in minutes (used when root-doc fallback is enabled). |

## Specification Authoring

| Key | Default | Notes |
|---|---|---|
| `specification.defaultSupplier` | `""` | Default supplier for new contract specs. |
| `specification.localContractRoot` | `""` | Root directory for local `.cspec` lookup. |
| `specification.localProtocolRoot` | `""` | Root directory for local `.pspec` lookup. |
| `specification.contractFilenameFormat` | `{layer}--{verb}--{subject}--{variation}--{platform}` | Template for new contract spec filenames. |
| `specification.protocolFilenameFormat` | `{layer}--{subject}--{variation}--{platform}` | Template for new protocol spec filenames. |

## Hover

| Key | Default | Notes |
|---|---|---|
| `emergent.hover.disabled` | `true` | Disables hover popups when true. |

## Bulk Validation

| Key | Default | Notes |
|---|---|---|
| `emergent.autopilotExtension` | `.dla` | Autopilot extension filter. |
| `emergent.pilotExtension` | `.dlp` | Pilot extension filter. |
| `emergent.bulkValidationMode` | `autopilot` | `autopilot`, `pilot`, or `both`. |
| `emergent.bulkValidationFolders` | `[]` | Relative workspace folder list; empty means all folders. |

## Protocol Design

| Key | Default | Notes |
|---|---|---|
| `protocolDesign.definitionPaths` | `[]` | Candidate `.pdd` files. Relative paths resolve from first workspace folder. |
| `protocolDesign.activeDefinition` | `""` | Explicit active `.pdd` override. |

## Diagnostics & Tracing

| Key | Default | Notes |
|---|---|---|
| `emergent.maxNumberOfProblems` | `100` | Cap on diagnostics returned by language server. |
| `emergent.trace.server` | `verbose` | LSP trace level (`off`, `messages`, `verbose`). |
| `emergent.hoverDebugLogging` | `false` | Extra hover/fetch logging in language-server output. |

## Deprecated Keys

`gateway.*` keys are deprecated and planned for removal in `0.12.0`.

Current compatibility behavior:
- `studio.*` is preferred.
- If a matching `studio.*` value is absent, legacy `gateway.*` may still be used.
- On activation, the extension attempts to migrate legacy values into `studio.*` when missing.
- A warning notification is shown when deprecated `gateway.*` fallback is still in use.

## Configuration Diagnostics Command

Use `Emergent: Show Configuration Diagnostics` to open a report with:
- effective Studio connection values
- effective spec-fetch/cache settings
- active cache file path
- diagnostics/hover/bulk-validation settings
- deprecated `gateway.*` fallback usage status

