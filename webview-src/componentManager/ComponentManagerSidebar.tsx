import React, { useMemo, useState } from "react";
import { vscode } from "../vscode";

type Position = { line: number; character: number };
type SourceRef = { uri: string; range?: { start: Position; end: Position } };

type ComponentEntry = {
  kind: "protocol" | "contract";
  classification: string;
  detail: string;
  directUseCount?: number;
  designBacked?: boolean;
  source: SourceRef;
  expressionTargets?: { source: SourceRef; label: string }[];
  newExpressionPath?: string;
};

type DiagnosticEntry = {
  severity: "error" | "warning";
  message: string;
  source: SourceRef;
};

function opensBeside(event: React.MouseEvent<HTMLElement>): boolean {
  return event.ctrlKey || event.metaKey;
}

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
  .cms-entry { display: flex; align-items: flex-start; gap: 6px; min-width: 0; padding: 5px 8px; }
  .cms-entry:hover { background: var(--vscode-list-hoverBackground); }
  .cms-entry-main { flex: 1; min-width: 0; }
  .cms-protocol-main { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 0; color: var(--vscode-foreground); background: transparent; border: 0; text-align: left; cursor: pointer; font: inherit; }
  .cms-protocol-main:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .cms-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cms-name.protocol::before { content: '◌  '; color: var(--vscode-charts-blue); }
  .cms-name.contract::before { content: '□  '; color: var(--vscode-charts-green); }
  .cms-detail { margin-top: 2px; color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .cms-entry-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
  .cms-action-button { display: grid; width: 24px; height: 24px; place-items: center; padding: 0; color: var(--vscode-icon-foreground); background: transparent; border: 1px solid transparent; border-radius: 2px; cursor: pointer; }
  .cms-action-button svg { width: 16px; height: 16px; }
  .cms-action-button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .cms-action-button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .cms-action-button:disabled { color: var(--vscode-disabledForeground); cursor: default; }
  .cms-action-button:disabled:hover { background: transparent; }
  .cms-empty { margin: 0; padding: 7px 8px; color: var(--vscode-descriptionForeground); }
  .cms-diagnostic { color: var(--vscode-inputValidation-warningForeground); }
  .cms-diagnostic.error { color: var(--vscode-inputValidation-errorForeground); }
`;

function EditSpecificationIcon() {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10.8 2.1a1.7 1.7 0 0 1 2.4 2.4l-7.1 7.1-3.3.9.9-3.3 7.1-7.1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="m9.7 3.2 2.4 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>;
}

function OpenExpressionIcon() {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 1.75h4l2 2v9.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M10 1.75v2h2M1.75 7.5h5.5m-2-2 2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function NewExpressionIcon() {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 1.75h4l2.5 2.5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 1.75v2.5h2.5M8 8.25v4m-2-2h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

function ComponentList({ entries, empty }: { entries: ComponentEntry[]; empty: string }) {
  if (!entries.length) return <p className="cms-empty">{empty}</p>;
  return <div className="cms-list">{entries.map((entry) => {
    const key = `${entry.kind}:${entry.source.uri}:${entry.classification}`;
    if (entry.kind === "contract") {
      const hasExpression = Boolean(entry.expressionTargets?.length);
      return <div key={key} className="cms-entry cms-contract">
        <span className="cms-name cms-entry-main contract">{entry.classification}</span>
        <div className="cms-entry-actions">
          <button className="cms-action-button" type="button" title="Edit specification" aria-label="Edit specification" onClick={(event) => vscode.postMessage({ type: "openSource", source: entry.source, openBeside: opensBeside(event) })}><EditSpecificationIcon /></button>
          <button
            className="cms-action-button"
            type="button"
            aria-label={hasExpression ? "Edit expression" : "New expression"}
            title={hasExpression ? "Edit expression" : "New expression"}
            disabled={!hasExpression && !entry.newExpressionPath}
            onClick={(event) => vscode.postMessage(hasExpression
              ? { type: "openContractExpression", classification: entry.classification, openBeside: opensBeside(event) }
              : { type: "createContractExpression", classification: entry.classification, source: entry.source, openBeside: opensBeside(event) })}
          >{hasExpression ? <OpenExpressionIcon /> : <NewExpressionIcon />}</button>
        </div>
      </div>;
    }
    return <div key={key} className="cms-entry cms-protocol">
      <button className="cms-protocol-main" type="button" onClick={() => {
        vscode.postMessage({ type: "openProtocol", classification: entry.classification });
      }}>
        <span className={`cms-name ${entry.kind}`}>{entry.classification}</span>
        <small className="cms-detail">{entry.detail}</small>
      </button>
      <div className="cms-entry-actions">
        <button className="cms-action-button" type="button" title="Edit specification" aria-label="Edit specification" onClick={(event) => vscode.postMessage({ type: "openSource", source: entry.source, openBeside: opensBeside(event) })}><EditSpecificationIcon /></button>
      </div>
    </div>;
  })}</div>;
}

export function ComponentManagerSidebar({ state }: { state: ComponentManagerSidebarState }) {
  const [query, setQuery] = useState("");
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [showContracts, setShowContracts] = useState(false);
  const [showProtocols, setShowProtocols] = useState(true);
  const [showUsed, setShowUsed] = useState(true);
  const [showSpecOnly, setShowSpecOnly] = useState(false);

  const protocols = useMemo(() => state.protocols.filter((entry) =>
    isMatch(entry.classification, query, wholeWord, regex)
      && (!showUsed || (entry.directUseCount ?? 0) > 0)
      && (showSpecOnly || entry.designBacked)
  ), [state.protocols, query, wholeWord, regex, showUsed, showSpecOnly]);
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
          <label title="Include protocol specifications that do not yet have a protocol design."><input type="checkbox" checked={showSpecOnly} onChange={(event) => setShowSpecOnly(event.target.checked)} /> Spec-only</label>
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
        <button key={`${diagnostic.source.uri}:${index}`} className={`cms-item cms-diagnostic ${diagnostic.severity}`} type="button" onClick={(event) => vscode.postMessage({ type: "openSource", source: diagnostic.source, openBeside: opensBeside(event) })}>
          <span>{diagnostic.severity}: {diagnostic.message}</span>
        </button>
      ))}</div> : <p className="cms-empty">No Component Manager diagnostics.</p>}
    </details>
  </main>;
}
