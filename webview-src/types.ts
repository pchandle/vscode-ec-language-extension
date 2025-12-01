export type HostMessage =
  | {
      type: "state";
      schema: unknown;
      value: unknown | null;
      errors: string[];
      parseError?: string;
    }
  | {
      type: "pdesState";
      value: unknown | null;
      pdd?: unknown;
      pddPath?: string;
      errors: string[];
      parseError?: string;
      protocolCompletions?: string[];
    };

export type WebviewMessage =
  | {
      type: "ready";
    }
  | {
      type: "updateDoc";
      value: unknown;
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
