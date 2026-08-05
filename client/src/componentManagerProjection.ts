/**
 * Renderer-neutral Component Manager graph projection.  This is deliberately
 * independent of VS Code and React Flow so the static-source relationship
 * rules can be verified without either UI runtime.
 */
export type SourceRef = {
  uri: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
};

export type HeaderTopic = { id: string; expressionLabel: string; displayName: string; source: SourceRef; jobHeaderSource: SourceRef };
export type ParticipationLabel = { label: string; source: SourceRef };
export type ExpressionDiagnostic = { message: string; severity: "error" | "warning" };
export type Participation = {
  role: "host" | "join";
  classification: string | null;
  requirements: ParticipationLabel[];
  obligations: ParticipationLabel[];
  /** Diagnostics whose source range is within this host/join statement. */
  diagnostics?: ExpressionDiagnostic[];
};
export type ProtocolSelfSlots = Partial<Record<"host" | "join", number>>;
export type SelectedProtocol = {
  classification: string;
  kind?: "protocolDesign" | "protocolSpecification";
  source?: SourceRef;
  selfSlots?: ProtocolSelfSlots;
};
export type ProjectionJobInput = {
  id: string;
  classification: string;
  source: SourceRef;
  requirements: HeaderTopic[];
  obligations: HeaderTopic[];
  statements: Participation[];
};

export type GraphBinding = {
  id: string;
  role: "host" | "join";
  jobId: string;
  lane: "requirements" | "obligations";
  topicId: string;
  expressionLabel: string;
  source: SourceRef;
  diagnostics: ExpressionDiagnostic[];
};
export type ProjectedJob = Omit<ProjectionJobInput, "statements"> & {
  bindings: GraphBinding[];
  side: "host" | "join";
  participation: "host" | "join" | "mixed";
};
export type ComponentGraphProjection = {
  selectedProtocol: SelectedProtocol;
  jobs: ProjectedJob[];
  counts: { directUseJobs: number; hostJobs: number; joinJobs: number };
};

/**
 * Project only semantic collaboration-self bindings. Host statements use the
 * selected protocol's host-obligation self slot; join statements use its
 * join-requirement self slot. The label must occur exactly once in the
 * corresponding job-header lane before it can be rendered as a graph edge.
 */
export function projectComponentGraph(
  selectedProtocol: SelectedProtocol,
  jobs: ProjectionJobInput[]
): ComponentGraphProjection {
  const projectedJobs = jobs.map((job) => {
    const bindingsByEndpoint = new Map<string, GraphBinding>();
    for (const statement of job.statements) {
      if (statement.classification !== selectedProtocol.classification) continue;
      const selfIndex = selectedProtocol.selfSlots?.[statement.role];
      if (selfIndex === undefined) continue;
      const lane = statement.role === "host" ? "obligations" : "requirements";
      const statementLabel = statement[lane][selfIndex];
      if (!statementLabel) continue;
      const matches = job[lane].filter((topic) => topic.expressionLabel === statementLabel.label);
      // Ambiguous, cross-lane, and absent labels are deliberately not edges.
      if (matches.length !== 1) continue;
      const topic = matches[0];
      const endpoint = `${statement.role}:${topic.id}`;
      if (!bindingsByEndpoint.has(endpoint)) {
        bindingsByEndpoint.set(endpoint, {
          id: `${job.id}:${statement.role}:${lane}:${selfIndex}:${topic.id}`,
          role: statement.role,
          jobId: job.id,
          lane,
          topicId: topic.id,
          expressionLabel: topic.expressionLabel,
          source: statementLabel.source,
          diagnostics: statement.diagnostics ?? [],
        });
      }
    }
    const bindings = [...bindingsByEndpoint.values()];

    const hasHost = bindings.some((binding) => binding.role === "host");
    const hasJoin = bindings.some((binding) => binding.role === "join");
    return {
      id: job.id,
      classification: job.classification,
      source: job.source,
      requirements: job.requirements,
      obligations: job.obligations,
      bindings,
      // A mixed participant is intentionally represented once on the host
      // side, while retaining every join binding through the central conduit.
      side: hasHost ? "host" as const : "join" as const,
      participation: hasHost && hasJoin ? "mixed" as const : hasHost ? "host" as const : "join" as const,
    };
  });

  const directJobs = projectedJobs.filter((job) => job.bindings.length > 0);
  return {
    selectedProtocol,
    // The graph is intentionally a direct-use design view. Non-participating
    // jobs remain indexed for sidebar diagnostics but are not graph state.
    jobs: directJobs,
    counts: {
      directUseJobs: directJobs.length,
      hostJobs: directJobs.filter((job) => job.side === "host").length,
      joinJobs: directJobs.filter((job) => job.side === "join").length,
    },
  };
}
