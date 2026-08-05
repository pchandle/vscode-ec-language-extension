import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls, Edge, Handle, Node, Position, ReactFlow, useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { vscode } from "../vscode";
import { layoutProtocolMap } from "../../client/src/componentManagerGraphLayout";
import { presentGraphLane } from "../../client/src/componentManagerGraphPresentation";

type Source = { uri: string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } };
type GraphTopic = { id: string; expressionLabel: string; displayName: string; source: Source; jobHeaderSource: Source };
type ExpressionDiagnostic = { message: string; severity: "error" | "warning" };
type Binding = { id: string; role: "host" | "join"; jobId: string; lane: "requirements" | "obligations"; topicId: string; expressionLabel: string; source: Source; diagnostics: ExpressionDiagnostic[] };
type Lane = "requirements" | "obligations";
type LaneExpansion = Record<Lane, boolean>;
type GraphJob = {
  id: string;
  classification: string;
  source: Source;
  requirements: GraphTopic[];
  obligations: GraphTopic[];
  bindings: Binding[];
  side: "host" | "join";
  participation: "host" | "join" | "mixed";
};
type JobCardData = GraphJob & {
  expanded: LaneExpansion;
  onToggleLane: (jobId: string, lane: Lane) => void;
  onHeightChange: (jobId: string, height: number) => void;
};
export type ComponentGraphState = {
  selectedProtocol: string;
  protocol?: { kind: "protocolDesign" | "protocolSpecification"; source: Source; selfMappingUnavailable?: Partial<Record<"host" | "join", string>> };
  jobs: GraphJob[];
  counts: { directUseJobs: number; hostJobs: number; joinJobs: number };
};

function open(source: Source, openBeside = false): void { vscode.postMessage({ type: "componentManagerOpenSource", source, openBeside }); }

function TopicRow({ topic, bindings, side }: { topic: GraphTopic; bindings: Binding[]; side: GraphJob["side"] }) {
  const hasHost = bindings.some((binding) => binding.role === "host");
  const hasJoin = bindings.some((binding) => binding.role === "join");
  const diagnostics = bindings.flatMap((binding) => binding.diagnostics)
    .filter((diagnostic, index, all) => all.findIndex((candidate) => candidate.message === diagnostic.message && candidate.severity === diagnostic.severity) === index);
  const diagnosticSummary = diagnostics.map((diagnostic) => `${diagnostic.severity === "error" ? "Error" : "Warning"}: ${diagnostic.message}`).join("\n");
  const towardConduit = side === "join" ? Position.Left : Position.Right;
  return <button className={`cm-topic ${bindings.length ? "cm-topic-bound" : ""}`} onClick={(event) => open(topic.source, event.ctrlKey || event.metaKey)} title={diagnosticSummary ? `${topic.displayName}\n${diagnosticSummary}` : topic.displayName}>
    {hasJoin && <Handle type="target" position={towardConduit} id={`${topic.id}:join`} />}
    <span className="cm-topic-label">{topic.displayName}</span>
    {diagnostics.length > 0 && <span className="cm-topic-warning" role="img" aria-label={`${diagnostics.length} expression ${diagnostics.length === 1 ? "diagnostic" : "diagnostics"}: ${diagnosticSummary}`} title={diagnosticSummary}>⚠</span>}
    {hasHost && <Handle type="source" position={Position.Right} id={`${topic.id}:host`} />}
  </button>;
}

function JobCard({ id, data }: { id: string; data: JobCardData }) {
  const cardRef = useRef<HTMLElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const bindingsFor = (topic: GraphTopic) => data.bindings.filter((binding) => binding.topicId === topic.id);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const reportHeight = () => data.onHeightChange(id, Math.ceil(card.offsetHeight));
    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(card);
    return () => observer.disconnect();
  }, [data.onHeightChange, id]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(frame);
  }, [data.expanded.obligations, data.expanded.requirements, id, updateNodeInternals]);
  const lane = (name: Lane, entries: GraphTopic[]) => {
    const openState = data.expanded[name];
    const boundTopicIds = new Set(entries.filter((topic) => bindingsFor(topic).length > 0).map((topic) => topic.id));
    const { visibleEntries: visibleTopics, canToggle } = presentGraphLane(entries, boundTopicIds, openState);
    const title = name === "requirements" ? "Requirements" : "Obligations";
    return <section className="cm-lane">
      {canToggle
        ? <button className="cm-lane-title" onClick={() => data.onToggleLane(id, name)} aria-expanded={openState} title={`${openState ? "Hide" : "Show"} ${name} contract topics`}><span>{openState ? "▾" : "▸"} {title}</span><small>{entries.length}</small></button>
        : <span className="cm-lane-label">{title}<small>{entries.length}</small></span>}
      {visibleTopics.map((topic) => <TopicRow key={topic.id} topic={topic} bindings={bindingsFor(topic)} side={data.side} />)}
    </section>;
  };
  return <article ref={cardRef} className={`cm-job cm-job-${data.participation}`}>
    <div className="cm-job-heading"><button className="cm-job-title" onClick={(event) => open(data.source, event.ctrlKey || event.metaKey)} title="Open job source">{data.classification}</button></div>
    <div className="cm-job-lanes">
      {lane("requirements", data.requirements)}
      {lane("obligations", data.obligations)}
    </div>
  </article>;
}

function ProtocolAnchor() {
  return <span className="cm-protocol-anchor" aria-hidden="true">
    <Handle type="target" position={Position.Left} id="host" />
    <Handle type="source" position={Position.Right} id="join" />
  </span>;
}

const nodeTypes = { job: JobCard, anchor: ProtocolAnchor };

function FitAfterRender({ token }: { token: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => fitView({ padding: 0.16, duration: 180 }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, token]);
  return null;
}

export function ComponentManagerGraph({ state }: { state: ComponentGraphState }) {
  const [listMode, setListMode] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [expandedLanes, setExpandedLanes] = useState<Record<string, LaneExpansion>>({});
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const queuedHeights = useRef(new Map<string, number>());
  const heightFrame = useRef<number>();
  useEffect(() => { setFitToken((value) => value + 1); }, [state.selectedProtocol]);
  useEffect(() => () => {
    if (heightFrame.current !== undefined) window.cancelAnimationFrame(heightFrame.current);
  }, []);
  useEffect(() => {
    queuedHeights.current.clear();
    setExpandedLanes({});
    setCardHeights({});
  }, [state.selectedProtocol]);

  const toggleLane = useCallback((jobId: string, lane: Lane) => {
    setExpandedLanes((current) => {
      const expanded = current[jobId] ?? { requirements: false, obligations: false };
      return { ...current, [jobId]: { ...expanded, [lane]: !expanded[lane] } };
    });
  }, []);
  const reportCardHeight = useCallback((jobId: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    queuedHeights.current.set(jobId, height);
    if (heightFrame.current !== undefined) return;
    heightFrame.current = window.requestAnimationFrame(() => {
      heightFrame.current = undefined;
      const measured = queuedHeights.current;
      queuedHeights.current = new Map<string, number>();
      setCardHeights((current) => {
        let next = current;
        measured.forEach((nextHeight, id) => {
          if (current[id] !== nextHeight) {
            if (next === current) next = { ...current };
            next[id] = nextHeight;
          }
        });
        return next;
      });
    });
  }, []);

  const { nodes, edges } = useMemo(() => {
    const layout = layoutProtocolMap(state.jobs.map((job) => ({ id: job.id, side: job.side, height: cardHeights[job.id] })));
    const nodes: Node[] = [
      ...state.jobs.map((job) => ({
        id: job.id,
        type: "job",
        position: layout.positions.get(job.id)!,
        data: {
          ...job,
          expanded: expandedLanes[job.id] ?? { requirements: false, obligations: false },
          onToggleLane: toggleLane,
          onHeightChange: reportCardHeight,
        },
      })),
      { id: "protocol-anchor", type: "anchor", position: layout.anchor, data: {} },
    ];
    const edges: Edge[] = state.jobs.flatMap((job) => job.bindings.map((binding) => {
      const host = binding.role === "host";
      return {
        id: binding.id,
        source: host ? job.id : "protocol-anchor",
        sourceHandle: host ? `${binding.topicId}:host` : "join",
        target: host ? "protocol-anchor" : job.id,
        targetHandle: host ? "host" : `${binding.topicId}:join`,
        type: "smoothstep",
        style: { stroke: host ? "var(--vscode-charts-orange, #d18616)" : "var(--vscode-charts-blue, #3794ff)", strokeWidth: 1.7 },
        labelStyle: { fill: "var(--vscode-descriptionForeground)", fontSize: 11 },
      };
    }));
    return { nodes, edges };
  }, [cardHeights, expandedLanes, reportCardHeight, state.jobs, toggleLane]);
  const unavailableMappings = state.protocol?.selfMappingUnavailable ?? {};
  const selfMappingWarnings = (["host", "join"] as const)
    .filter((role) => unavailableMappings[role])
    .map((role) => `${role === "host" ? "Host" : "Join"} wiring unavailable: ${unavailableMappings[role]}`);

  return <main className="cm-root">
    <header className="cm-header">
      <div className="cm-heading"><strong>{state.selectedProtocol}</strong>{state.protocol?.kind === "protocolSpecification" && <span className="cm-spec-only">Spec-only</span>}<small>{state.counts.directUseJobs} jobs · {state.counts.hostJobs} host · {state.counts.joinJobs} join</small>{selfMappingWarnings.map((warning) => <small key={warning} className="cm-self-warning">{warning}</small>)}</div>
      <button onClick={() => setFitToken((value) => value + 1)} title="Center and zoom the displayed relationship map" aria-label="Center graph">Center graph</button>
      <button onClick={() => setListMode((value) => !value)} title={listMode ? "Return to the relationship map" : "View the same relationships as a keyboard-friendly list"}>{listMode ? "Show graph" : "Show relationship list"}</button>
      {state.protocol && <button onClick={(event) => open(state.protocol!.source, event.ctrlKey || event.metaKey)}>Open protocol source</button>}
    </header>
    {listMode ? <section className="cm-accessible" aria-label="Protocol design relationship list">
      <p>This keyboard-friendly list contains the same direct protocol design relationships shown on the map. Activate a job or contract topic to open its source.</p>
      {state.jobs.map((job) => <article key={job.id}><button onClick={(event) => open(job.source, event.ctrlKey || event.metaKey)}>{job.classification}</button><ul>{job.bindings.map((binding) => {
        const topic = (binding.lane === "requirements" ? job.requirements : job.obligations).find((entry) => entry.id === binding.topicId);
        return <li key={binding.id}>{binding.role} → {binding.lane} <button onClick={(event) => topic && open(topic.source, event.ctrlKey || event.metaKey)}>{topic?.displayName ?? binding.expressionLabel}</button></li>;
      })}</ul></article>)}
    </section> : <section className="cm-canvas" aria-label="Protocol design relationship map">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable proOptions={{ hideAttribution: true }}>
        <FitAfterRender token={fitToken} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>}
    <style>{styles}</style>
  </main>;
}

const styles = `.cm-root{height:100vh;display:flex;flex-direction:column;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}.cm-header{display:flex;gap:7px;align-items:center;padding:8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-wrap:wrap}.cm-heading{display:flex;flex-direction:column;margin-right:auto;min-width:200px}.cm-heading small{color:var(--vscode-descriptionForeground);margin-top:2px}.cm-heading .cm-self-warning{color:var(--vscode-editorWarning-foreground)}button{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:2px;padding:4px 7px;cursor:pointer;font:inherit}.cm-spec-only{color:var(--vscode-editorWarning-foreground);margin-left:7px}.cm-canvas{flex:1;min-height:0}.cm-job{width:280px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:5px;padding:7px}.cm-job-host{border-left:3px solid var(--vscode-charts-orange, #d18616)}.cm-job-join{border-left:3px solid var(--vscode-charts-blue, #3794ff)}.cm-job-mixed{border-left:3px solid var(--vscode-charts-purple, #b267e6)}.cm-job-heading{display:flex;align-items:flex-start}.cm-job-title{flex:1;min-width:0;font-weight:600;text-align:left;color:var(--vscode-foreground);background:transparent;padding:0;overflow:hidden;text-overflow:ellipsis}.cm-job-lanes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.cm-lane{min-width:0;margin-top:7px}.cm-lane-title,.cm-lane-label{display:flex;justify-content:space-between;width:100%;text-align:left;color:var(--vscode-foreground);padding:1px 0}.cm-lane-title{background:transparent}.cm-lane-title small{color:var(--vscode-descriptionForeground)}.cm-topic{display:flex;position:relative;width:100%;gap:4px;align-items:center;margin:2px 0;text-align:left;background:var(--vscode-list-inactiveSelectionBackground);color:var(--vscode-foreground);overflow:hidden;white-space:nowrap;padding:2px 4px}.cm-topic-label{min-width:0;overflow:hidden;text-overflow:ellipsis}.cm-topic-warning{flex:none;color:var(--vscode-editorWarning-foreground);font-size:12px}.cm-topic-bound{outline:1px solid var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground)}.cm-protocol-anchor{display:block;width:1px;height:1px;opacity:0;pointer-events:none}.cm-accessible{padding:14px;overflow:auto}.cm-accessible article{padding:8px;border-bottom:1px solid var(--vscode-editorWidget-border)}.cm-accessible article>button{color:var(--vscode-textLink-foreground);background:transparent;padding-left:0}.cm-accessible li button{margin-left:5px}.react-flow__controls{box-shadow:0 1px 4px rgba(0,0,0,.25)}`;
