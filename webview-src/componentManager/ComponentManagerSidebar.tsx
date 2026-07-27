import React, { useMemo, useState } from "react";
import { vscode } from "../vscode";

type Position = { line: number; character: number };
type SourceRef = { uri: string; range?: { start: Position; end: Position } };

type ComponentEntry = {
  kind: "protocol" | "contract";
  classification: string;
  detail: string;
  directUseCount?: number;
  managed?: boolean;
  source: SourceRef;
};

type DiagnosticEntry = {
  severity: "error" | "warning";
  message: string;
  source: SourceRef;
};

export type ComponentManagerSidebarState = {
  status: { indexing: boolean; processed: number; total: number };
  protocols: ComponentEntry[];
  contracts: ComponentEntry[];
  diagnostics: DiagnosticEntry[];
  directories: string[];
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMatch(value: string, query: string, wholeWord: boolean, regex: boolean): boolean {
  if (!query) return true;
  try {
    if (regex) return new RegExp(query, "i").test(value);
    if (wholeWord) return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(query)}($|[^A-Za-z0-9_])`, "i").test(value);
    return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  } catch {
    return false;
  }
}

const styles = `
  :root { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .cms { display: flex; flex-direction: column; min-height: 100vh; }
  .cms-section { border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }
  .cms-section > summary { height: 28px; display: flex; align-items: center; padding: 0 8px; cursor: pointer; user-select: none; color: var(--vscode-sideBarSectionHeader-foreground); background: var(--vscode-sideBarSectionHeader-background); font-weight: 600; text-transform: uppercase; }
  .cms-section > summary::marker { color: var(--vscode-icon-foreground); }
  .cms-content { padding: 7px 8px; }
  .cms-search { display: flex; min-width: 0; border: 1px solid var(--vscode-focusBorder); border-radius: 2px; overflow: hidden; }
  .cms-search input { flex: 1; min-width: 0; padding: 6px 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 0; outline: 0; font: inherit; }
  .cms-icon-button { width: 32px; padding: 0; color: var(--vscode-input-foreground); background: transparent; border: 0; border-left: 1px solid var(--vscode-input-border); cursor: pointer; font: inherit; font-weight: 600; }
  .cms-icon-button[aria-pressed=true] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .cms-scope { display: flex; gap: 12px; align-items: center; margin-top: 7px; }
  .cms-scope label { white-space: nowrap; cursor: pointer; }
  .cms-count { margin-left: auto; color: var(--vscode-descriptionForeground); white-space: nowrap; }
  .cms-status { margin: 8px 0 0; color: var(--vscode-descriptionForeground); }
  .cms-list { display: flex; flex-direction: column; max-height: 37vh; overflow-y: auto; }
  .cms-item { display: flex; flex-direction: column; width: 100%; padding: 5px 8px; color: var(--vscode-foreground); background: transparent; border: 0; text-align: left; cursor: pointer; font: inherit; }
  .cms-item:hover, .cms-item:focus-visible { background: var(--vscode-list-hoverBackground); outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .cms-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cms-name.protocol::before { content: '◌  '; color: var(--vscode-charts-blue); }
  .cms-name.contract::before { content: '□  '; color: var(--vscode-charts-green); }
  .cms-detail { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .cms-empty { margin: 0; padding: 7px 8px; color: var(--vscode-descriptionForeground); }
  .cms-diagnostic { color: var(--vscode-inputValidation-warningForeground); }
  .cms-diagnostic.error { color: var(--vscode-inputValidation-errorForeground); }
`;

function ComponentList({ entries, empty }: { entries: ComponentEntry[]; empty: string }) {
  if (!entries.length) return <p className="cms-empty">{empty}</p>;
  return <div className="cms-list">{entries.map((entry) => (
    <button key={`${entry.kind}:${entry.source.uri}:${entry.classification}`} className="cms-item" type="button" onClick={() => {
      vscode.postMessage(entry.kind === "protocol" ? { type: "openProtocol", classification: entry.classification } : { type: "openSource", source: entry.source });
    }}>
      <span className={`cms-name ${entry.kind}`}>{entry.classification}</span>
      <small className="cms-detail">{entry.detail}</small>
    </button>
  ))}</div>;
}

export function ComponentManagerSidebar({ state }: { state: ComponentManagerSidebarState }) {
  const [query, setQuery] = useState("");
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [showContracts, setShowContracts] = useState(false);
  const [showProtocols, setShowProtocols] = useState(true);
  const [showUsed, setShowUsed] = useState(true);
  const [showLegacy, setShowLegacy] = useState(false);

  const protocols = useMemo(() => state.protocols.filter((entry) =>
    isMatch(entry.classification, query, wholeWord, regex)
      && (!showUsed || (entry.directUseCount ?? 0) > 0)
      && (showLegacy || entry.managed)
  ), [state.protocols, query, wholeWord, regex, showUsed, showLegacy]);
  const contracts = useMemo(() => state.contracts.filter((entry) => isMatch(entry.classification, query, wholeWord, regex)), [state.contracts, query, wholeWord, regex]);
  const displayedCount = (showProtocols ? protocols.length : 0) + (showContracts ? contracts.length : 0);
  const status = state.status.indexing
    ? `Indexing Component Manager · ${state.status.processed} / ${state.status.total}`
    : `Index ready · ${state.protocols.length} protocols · ${state.contracts.length} contracts`;

  return <main className="cms">
    <style>{styles}</style>
    <details className="cms-section" open>
      <summary>Search &amp; filters</summary>
      <div className="cms-content">
        <div className="cms-search">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search component library" aria-label="Search component library" />
          <button className="cms-icon-button" type="button" title="Match whole word" aria-label="Match whole word" aria-pressed={wholeWord} onClick={() => setWholeWord((value) => !value)}>ab</button>
          <button className="cms-icon-button" type="button" title="Use regular expression" aria-label="Use regular expression" aria-pressed={regex} onClick={() => setRegex((value) => !value)}>.*</button>
        </div>
        <div className="cms-scope">
          <label><input type="checkbox" checked={showContracts} onChange={(event) => setShowContracts(event.target.checked)} /> Contracts</label>
          <label><input type="checkbox" checked={showProtocols} onChange={(event) => setShowProtocols(event.target.checked)} /> Protocols</label>
          <label title="Show only protocols with at least one direct host or join use"><input type="checkbox" checked={showUsed} onChange={(event) => setShowUsed(event.target.checked)} /> Used</label>
          <label title="Include protocols available only through a legacy .pspec file"><input type="checkbox" checked={showLegacy} onChange={(event) => setShowLegacy(event.target.checked)} /> Legacy</label>
          <span className="cms-count">{displayedCount} result{displayedCount === 1 ? "" : "s"}</span>
        </div>
        <p className="cms-status" role="status">{status}</p>
      </div>
    </details>
    <details className="cms-section" open>
      <summary>Protocols ({showProtocols ? protocols.length : 0})</summary>
      {showProtocols ? <ComponentList entries={protocols} empty={showUsed ? "No matching used protocols." : "No matching protocols."} /> : <p className="cms-empty">Protocols are hidden by the filter.</p>}
    </details>
    <details className="cms-section">
      <summary>Contracts ({showContracts ? contracts.length : 0})</summary>
      {showContracts ? <ComponentList entries={contracts} empty="No matching contracts." /> : <p className="cms-empty">Enable Contracts in Search &amp; filters to show them.</p>}
    </details>
    <details className="cms-section">
      <summary>Diagnostics ({state.diagnostics.length})</summary>
      {state.diagnostics.length ? <div className="cms-list">{state.diagnostics.map((diagnostic, index) => (
        <button key={`${diagnostic.source.uri}:${index}`} className={`cms-item cms-diagnostic ${diagnostic.severity}`} type="button" onClick={() => vscode.postMessage({ type: "openSource", source: diagnostic.source })}>
          <span>{diagnostic.severity}: {diagnostic.message}</span>
        </button>
      ))}</div> : <p className="cms-empty">No Component Manager diagnostics.</p>}
    </details>
  </main>;
}
