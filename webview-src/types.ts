export type HostMessage =
  | {
      type: "state";
      schema: unknown;
      value: unknown | null;
      errors: string[];
      parseError?: string;
      contractCompletions?: string[];
      canCreatePdes?: boolean;
      ackRevision?: number;
      preserveDraft?: boolean;
    }
  | {
      type: "pdesState";
      value: unknown | null;
      pdd?: unknown;
      pddPath?: string;
      errors: string[];
      parseError?: string;
      protocolCompletions?: string[];
      canExportPspec: boolean;
      ackRevision?: number;
    }
  | {
      type: "pddState";
      value: unknown | null;
      errors: string[];
      parseError?: string;
      ackRevision?: number;
    }
  | {
      type: "componentManagerGraph";
      selectedProtocol: string;
      protocol?: unknown;
      jobs: unknown[];
      counts: { directUseJobs: number; hostJobs: number; joinJobs: number };
    }
  | {
      type: "componentManagerSidebar";
      status: { indexing: boolean; processed: number; total: number };
      protocols: unknown[];
      contracts: unknown[];
      diagnostics: unknown[];
      directories: string[];
    };

export type WebviewMessage =
  | {
      type: "ready";
    }
  | {
      type: "updateDoc";
      value: unknown;
      revision: number;
    }
  | {
      type: "createPdes";
    }
  | {
      type: "exportPspec";
      value: unknown;
      revision: number;
    }
  | {
      type: "componentManagerOpenSource";
      source: unknown;
    };

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

export interface PddMacroWarning {
  lineIndex: number;
  message: string;
}

export interface ProtocolDesignTopicInstance {
  name: string;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProtocolDesignModeInstance {
  modeTemplate: string;
  collaborationLabel?: string;
  topics: ProtocolDesignTopicInstance[];
  [key: string]: unknown;
}

export interface ProtocolDesign {
  protocolDesignVersion: number;
  classification: string;
  description: string;
  policy: string | number;
  modes: ProtocolDesignModeInstance[];
  [key: string]: unknown;
}
