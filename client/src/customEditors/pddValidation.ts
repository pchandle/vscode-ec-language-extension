import * as vscode from "vscode";

export type TopicRole = "host" | "join";
export type TopicConstraint = "requirement" | "obligation";
export type TopicType = "abstraction" | "integer" | "string" | "boolean";

export interface MacroGlobal {
  def: string;
  header: string;
  footer: string;
  [key: string]: unknown;
}

export interface ModeTemplateTopic {
  name: string;
  role: TopicRole;
  constraint: TopicConstraint;
  type: TopicType;
  comment?: string;
  [key: string]: unknown;
}

export interface ModeTemplate {
  name: string;
  topics: ModeTemplateTopic[];
  hostMacroTemplates: string[];
  joinMacroTemplates: string[];
  [key: string]: unknown;
}

export interface ProtocolDesignDefinition {
  protocolDesignVersion: number;
  hostMacroGlobal: MacroGlobal;
  joinMacroGlobal: MacroGlobal;
  modeTemplates: ModeTemplate[];
  [key: string]: unknown;
}

export interface SemanticDiagnostic {
  path: (string | number)[];
  message: string;
  severity: vscode.DiagnosticSeverity;
}

const TOPIC_TOKEN_RE = /\$TOPIC_(\d+)/g;
const MALFORMED_TOPIC_TOKEN_RE = /\$TOPIC_([^\d\s,()]+)/g;

export function collectPddSemanticDiagnostics(value: unknown): SemanticDiagnostic[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const pdd = value as Partial<ProtocolDesignDefinition>;
  const diagnostics: SemanticDiagnostic[] = [];
  const templateNameToIndexes = new Map<string, number[]>();

  for (const [index, template] of (pdd.modeTemplates ?? []).entries()) {
    if (!template || typeof template !== "object") {
      continue;
    }
    const name = typeof template.name === "string" ? template.name.trim() : "";
    if (!name) {
      continue;
    }
    const indexes = templateNameToIndexes.get(name) ?? [];
    indexes.push(index);
    templateNameToIndexes.set(name, indexes);
  }

  for (const [name, indexes] of templateNameToIndexes.entries()) {
    if (indexes.length < 2) {
      continue;
    }
    for (const index of indexes) {
      diagnostics.push({
        path: ["modeTemplates", index, "name"],
        message: `Mode template name "${name}" must be unique.`,
        severity: vscode.DiagnosticSeverity.Error,
      });
    }
  }

  const checkGlobalDef = (globalKey: "hostMacroGlobal" | "joinMacroGlobal", label: string) => {
    const global = pdd[globalKey];
    if (!global || typeof global !== "object" || typeof global.def !== "string") {
      return;
    }
    if (!global.def.includes("$TOPICS")) {
      diagnostics.push({
        path: [globalKey, "def"],
        message: `${label} def should contain $TOPICS so exported topic identifiers can be injected.`,
        severity: vscode.DiagnosticSeverity.Warning,
      });
    }
  };

  checkGlobalDef("hostMacroGlobal", "Host macro");
  checkGlobalDef("joinMacroGlobal", "Join macro");

  for (const [templateIndex, template] of (pdd.modeTemplates ?? []).entries()) {
    if (!template || typeof template !== "object") {
      continue;
    }
    checkMacroLines(diagnostics, template, templateIndex, "hostMacroTemplates", "host");
    checkMacroLines(diagnostics, template, templateIndex, "joinMacroTemplates", "join");
  }

  return diagnostics;
}

function checkMacroLines(
  diagnostics: SemanticDiagnostic[],
  template: Partial<ModeTemplate>,
  templateIndex: number,
  key: "hostMacroTemplates" | "joinMacroTemplates",
  label: "host" | "join"
) {
  const topics = Array.isArray(template.topics) ? template.topics : [];
  const lines = Array.isArray(template[key]) ? template[key] : [];

  for (const [lineIndex, line] of lines.entries()) {
    if (typeof line !== "string") {
      continue;
    }

    let match: RegExpExecArray | null;
    TOPIC_TOKEN_RE.lastIndex = 0;
    while ((match = TOPIC_TOKEN_RE.exec(line)) !== null) {
      const topicIndex = Number(match[1]);
      if (!Number.isInteger(topicIndex) || topicIndex < 0 || topicIndex >= topics.length) {
        diagnostics.push({
          path: ["modeTemplates", templateIndex, key, lineIndex],
          message: `${label} macro references $TOPIC_${match[1]}, but this template only has ${topics.length} topic(s).`,
          severity: vscode.DiagnosticSeverity.Warning,
        });
      }
    }

    MALFORMED_TOPIC_TOKEN_RE.lastIndex = 0;
    while ((match = MALFORMED_TOPIC_TOKEN_RE.exec(line)) !== null) {
      diagnostics.push({
        path: ["modeTemplates", templateIndex, key, lineIndex],
        message: `${label} macro uses malformed topic token $TOPIC_${match[1]}. Use $TOPIC_<index>.`,
        severity: vscode.DiagnosticSeverity.Warning,
      });
    }
  }
}
