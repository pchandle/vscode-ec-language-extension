import { ModeTemplate, ProtocolDesignDefinition } from "../pddLoader";
import { PdesDesign, transformPdesToPspec } from "./transform";
import * as path from "path";

export type PspecTopic = {
  type: string;
  name: string;
  [key: string]: unknown;
};

export type Pspec = {
  type: "protocol";
  name: string;
  description: string;
  policy: string | number;
  host: { requirements: PspecTopic[]; obligations: PspecTopic[]; macro: string };
  join: { requirements: PspecTopic[]; obligations: PspecTopic[]; macro: string };
};

export type MigrationIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
};

export type MigrationMode = PdesDesign["modes"][number] & {
  sourceTopicIds: string[];
  candidates?: string[];
  inferred: boolean;
  labelRequiresDecision?: boolean;
};

export type PspecMigrationPlan = {
  design: PdesDesign;
  modes: MigrationMode[];
  issues: MigrationIssue[];
  canCreate: boolean;
};

export type MigrationChoices = {
  /** One selected template name for each ambiguous proposed mode. */
  modeTemplates?: Record<number, string>;
  /** Explicit collaboration labels, keyed by proposed mode index. */
  labels?: Record<number, string>;
};

/**
 * Legacy .pspec files commonly encode text fields as arrays or null. Migration
 * must not rewrite the source, but it can safely normalise those forms in memory.
 */
export function normalizeLegacyPspec(value: unknown): Pspec | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const clone = JSON.parse(JSON.stringify(value)) as any;
  if (Array.isArray(clone.description)) {
    clone.description = clone.description.join("\n");
  } else if (clone.description === null || clone.description === undefined) {
    clone.description = "";
  } else if (typeof clone.description !== "string") {
    clone.description = String(clone.description);
  }
  for (const role of ["host", "join"]) {
    if (!clone[role] || typeof clone[role] !== "object") {
      continue;
    }
    if (Array.isArray(clone[role].macro)) {
      clone[role].macro = clone[role].macro.join("\n");
    } else if (clone[role].macro === null || clone[role].macro === undefined) {
      clone[role].macro = "";
    }
    for (const collection of ["requirements", "obligations"]) {
      if (clone[role][collection] === null || clone[role][collection] === undefined) {
        clone[role][collection] = [];
      }
    }
  }
  return clone as Pspec;
}

type SourceTopic = {
  id: string;
  role: "host" | "join";
  constraint: "requirement" | "obligation";
  topic: PspecTopic;
};

const SUPPORTED_TOPIC_TYPES = new Set(["abstraction", "integer", "string", "boolean"]);

function isCanonicalSelf(source: SourceTopic, classification: string): boolean {
  return (
    source.topic.type === "abstraction" &&
    source.topic.name === "<self>" &&
    source.topic.protocol === classification &&
    ((source.role === "host" && source.constraint === "obligation") ||
      (source.role === "join" && source.constraint === "requirement"))
  );
}

function sourcesFor(pspec: Pspec): SourceTopic[] {
  const result: SourceTopic[] = [];
  for (const role of ["host", "join"] as const) {
    for (const constraint of ["requirements", "obligations"] as const) {
      const normalizedConstraint = constraint === "requirements" ? "requirement" : "obligation";
      const topics = pspec[role]?.[constraint] ?? [];
      topics.forEach((topic, index) => {
        result.push({ id: `${role}.${constraint}.${index}`, role, constraint: normalizedConstraint, topic });
      });
    }
  }
  return result;
}

function normalizeIdentifier(name: string, counter: Record<string, number>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "topic";
  const count = counter[base] ?? 0;
  counter[base] = count + 1;
  return count === 0 ? base : `${base}${count}`;
}

function macroIdentifiers(sources: SourceTopic[]): Map<string, string> {
  const identifiers = new Map<string, string>();
  const counters: Record<"host" | "join", Record<string, number>> = { host: {}, join: {} };
  for (const source of sources) {
    identifiers.set(source.id, normalizeIdentifier(source.topic.name, counters[source.role]));
  }
  return identifiers;
}

function macroEvidence(
  template: ModeTemplate,
  selected: SourceTopic[],
  identifiers: Map<string, string>,
  pspec: Pspec
): boolean {
  const hasTemplateText = (macros: string[] | undefined, source: string) =>
    (macros ?? []).every((macro) => {
      const instantiated = macro.replace(/\$TOPIC_(\d+)/g, (_match, index) => identifiers.get(selected[Number(index)]?.id) ?? "");
      return instantiated.length > 0 && source.includes(instantiated);
    });
  return hasTemplateText(template.hostMacroTemplates, pspec.host?.macro ?? "") && hasTemplateText(template.joinMacroTemplates, pspec.join?.macro ?? "");
}

function properties(topic: PspecTopic): Record<string, unknown> {
  const { type: _type, name: _name, ...rest } = topic;
  return rest;
}

/**
 * The historic exporter named the implicit endpoint parameter `chain_inout`.
 * The versioned PDD uses `self`; the binding and position are otherwise the
 * same. Ignore that spelling and insignificant layout when comparing macros.
 */
function canonicalMacro(macro: unknown): string {
  const text = Array.isArray(macro) ? macro.join("\n") : String(macro ?? "");
  return text.replace(/\bchain_inout\b/g, "self").replace(/\s+/g, "");
}

function macrosEquivalent(left: unknown, right: unknown): boolean {
  return canonicalMacro(left) === canonicalMacro(right);
}

function defaultLabel(topics: SourceTopic[]): { label: string; requiresDecision: boolean } {
  const names = Array.from(new Set(topics.map((topic) => topic.topic.name.trim()).filter(Boolean)));
  return { label: names.length === 1 ? names[0] : "", requiresDecision: names.length !== 1 };
}

function selectTopics(template: ModeTemplate, remaining: SourceTopic[]): SourceTopic[] | undefined {
  const selected: SourceTopic[] = [];
  for (const expected of template.topics ?? []) {
    const match = remaining.find(
      (source) =>
        !selected.includes(source) &&
        source.role === expected.role &&
        source.constraint === expected.constraint &&
        source.topic.type === expected.type
    );
    if (!match) {
      return undefined;
    }
    selected.push(match);
  }
  return selected;
}

/**
 * Produces a conservative, reviewable proposal. A .pspec does not retain its
 * original mode boundaries, so only a unique macro/signature match is inferred;
 * same-shaped templates are exposed as candidates for the migration review.
 */
export function transformPspecToPdes(
  pspec: Pspec,
  pdd: ProtocolDesignDefinition,
  choices: MigrationChoices = {}
): PspecMigrationPlan {
  const issues: MigrationIssue[] = [];
  const design: PdesDesign = {
    protocolDesignVersion: pdd?.protocolDesignVersion ?? 1,
    classification: pspec?.name ?? "",
    description: pspec?.description ?? "",
    policy: pspec?.policy ?? 0,
    modes: [],
  };

  if (!pspec || pspec.type !== "protocol" || !pspec.name || !pspec.host || !pspec.join) {
    issues.push({ severity: "error", code: "invalid-pspec", message: "The source is not a valid protocol specification." });
    return { design, modes: [], issues, canCreate: false };
  }
  if (!pdd?.modeTemplates?.length) {
    issues.push({ severity: "error", code: "missing-pdd", message: "The selected protocol design definition has no mode templates." });
    return { design, modes: [], issues, canCreate: false };
  }

  const sources = sourcesFor(pspec).filter((source) => !isCanonicalSelf(source, pspec.name));
  const identifiers = macroIdentifiers(sources);
  for (const source of sources) {
    if (!SUPPORTED_TOPIC_TYPES.has(source.topic.type)) {
      issues.push({
        severity: "error",
        code: "unsupported-topic",
        message: `${source.id} has unsupported topic type "${source.topic.type}".`,
      });
    }
  }

  const remaining = [...sources];
  const modes: MigrationMode[] = [];
  while (remaining.length > 0) {
    const possible = (pdd.modeTemplates ?? []).filter((template) => Boolean(selectTopics(template, remaining)));
    if (possible.length === 0) {
      const source = remaining[0];
      issues.push({ severity: "error", code: "unmatched-topic", message: `${source.id} cannot be mapped to a selected .pdd mode.` });
      remaining.shift();
      continue;
    }

    const evidenced = possible.filter((template) => {
      const selected = selectTopics(template, remaining);
      return Boolean(selected && macroEvidence(template, selected, identifiers, pspec));
    });
    const candidates = evidenced.length === 1 ? evidenced : possible;
    const selection = choices.modeTemplates?.[modes.length];
    const template = selection ? candidates.find((candidate) => candidate.name === selection) : undefined;
    const chosen = template ?? (candidates.length === 1 ? candidates[0] : undefined);
    const templateForTopics = chosen ?? candidates[0];
    const selected = selectTopics(templateForTopics, remaining)!;
    const label = choices.labels?.[modes.length] ?? defaultLabel(selected).label;
    const labelDecision = defaultLabel(selected).requiresDecision && !choices.labels?.[modes.length];

    if (!chosen) {
      issues.push({
        severity: "warning",
        code: "ambiguous-mode",
        message: `Source topics ${selected.map((topic) => topic.id).join(", ")} match multiple modes: ${candidates.map((candidate) => candidate.name).join(", ")}.`,
      });
    }
    if (labelDecision || !label.trim()) {
      issues.push({
        severity: "warning",
        code: "label-required",
        message: `Mode ${modes.length + 1} needs a collaboration label because its legacy topic names differ.`,
      });
    }

    const mode: MigrationMode = {
      modeTemplate: chosen?.name ?? templateForTopics.name,
      collaborationLabel: label,
      topics: selected.map((source) => ({
        name: source.topic.name,
        properties: properties(source.topic),
      })),
      sourceTopicIds: selected.map((source) => source.id),
      candidates: candidates.length > 1 ? candidates.map((candidate) => candidate.name) : undefined,
      inferred: Boolean(chosen || candidates.length === 1),
      labelRequiresDecision: labelDecision,
    };
    modes.push(mode);
    design.modes.push({ modeTemplate: mode.modeTemplate, collaborationLabel: mode.collaborationLabel, topics: mode.topics });
    for (const source of selected) {
      remaining.splice(remaining.indexOf(source), 1);
    }
  }

  const sourceIds = modes.flatMap((mode) => mode.sourceTopicIds);
  if (new Set(sourceIds).size !== sourceIds.length) {
    issues.push({ severity: "error", code: "duplicate-assignment", message: "A legacy topic was assigned to more than one mode." });
  }
  const blocking = issues.some((issue) => issue.severity === "error");
  const pendingDecisions = modes.some((mode) => Boolean(mode.candidates && mode.candidates.length > 1) || !mode.collaborationLabel?.trim());
  if (!blocking && !pendingDecisions) {
    const regenerated = transformPdesToPspec(design, pdd);
    if (regenerated.pspec) {
      if (!macrosEquivalent(regenerated.pspec.host.macro, pspec.host.macro) || !macrosEquivalent(regenerated.pspec.join.macro, pspec.join.macro)) {
        issues.push({
          severity: "warning",
          code: "macro-difference",
          message: "The regenerated host or join macro differs from the legacy specification.",
        });
      }
      const sourceTopics = JSON.stringify({
        host: { requirements: pspec.host.requirements, obligations: pspec.host.obligations },
        join: { requirements: pspec.join.requirements, obligations: pspec.join.obligations },
      });
      const regeneratedTopics = JSON.stringify({
        host: { requirements: regenerated.pspec.host.requirements, obligations: regenerated.pspec.host.obligations },
        join: { requirements: regenerated.pspec.join.requirements, obligations: regenerated.pspec.join.obligations },
      });
      if (sourceTopics !== regeneratedTopics) {
        issues.push({
          severity: "warning",
          code: "interface-difference",
          message: "The regenerated public topic interface differs from the legacy specification; review the collaboration labels.",
        });
      }
    }
  }
  return { design, modes, issues, canCreate: !blocking && !pendingDecisions };
}

export function hasSiblingPdes(sourcePath: string, exists: (path: string) => boolean): boolean {
  const target = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}.pdes`);
  return exists(target);
}
