# Changelog

All notable changes to this project are documented here.

## 0.9.0 - 2025-12-02
- Add protocol design definition custom editor (.pdd) plus a command to create protocol specs (with follow-up fixes).
- Improve protocol editors with copy/paste fields, custom icons, collaboration/abstraction auto-complete, and host/join auto-completion.
- Refine contract spec authoring with default filename templates, auto-filled contract names, better colouring, and fixes for requirement/obligation expansion.
- Expand IntelliSense: protocol classification suggestions in contract topics, job/substatement and sub-body completions, and Gateway-proxied spec fetch for reliability.
- UI polish including updated trash icon and related tweaks.

## 0.8.2 - 2025-11-24
- Fix classification name completion scope so suggestions end at punctuation/whitespace.
- Raise minimum VS Code version to 1.75.0 and remove activation events during startup.

## 0.8.1 - 2025-11-24
- Add specification webview with shortcut, Emergent network configuration, and styled specification markdown.
- Introduce contract specification editor with .cspec/.pspec associations and a "new contract spec" command.
- Add hover-disable setting, ctrl-click to open classification names, and consistent parenthesis colouring.
- Allow opening/editing local contract or protocol specs; tighten requirement/obligation validation and improve auto-completion.
- Add command to reload the specification cache.

## 0.8.0 - 2025-11-22
- Add hover debug logging option and fix root document fetch/processing.
- Move contract completion to the server, improve fetch error reporting/status text, and correct formatting/equality issues.
- Improve syntax highlighting for asset/deliver statements and clean up repository assets.

## 0.7.2 - 2024-06-18
- Fix greedy string syntax highlighting.
- Add contract specification lookups when hovering job statements.

## 0.7.1 - 2024-06-17
- Fix handling of defaults when they are not the first line in a document.

## 0.7.0 - 2024-06-17
- Release housekeeping ahead of subsequent fixes.

## 0.6.0 - 2024-06-17
- Major changes to Valley data retrieval and caching.

## 0.5.0 - 2022-12-17
- Add status bar display of Gateway status.

## 0.4.0 - 2022-12-16
- Reorganize tests and refine ignore rules around node_modules handling.

## 0.3.0 - 2022-12-16
- Add initial project documents.

## 0.2.0 - 2022-12-16
- Exclude node_modules folder.

## 0.1.0 - 2022-12-16
- Initial release with Gateway configuration options.
