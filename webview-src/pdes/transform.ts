type TopicRole = "host" | "join";
type TopicConstraint = "requirement" | "obligation";
type TopicType = "abstraction" | "integer" | "string" | "boolean";

export interface PddTopic {
  name: string;
  role: TopicRole;
  constraint: TopicConstraint;
  type: TopicType;
}

export interface PddModeTemplate {
  name: string;
  topics: PddTopic[];
  hostMacroTemplates: string[];
  joinMacroTemplates: string[];
}

export interface PddDefinition {
  protocolDesignVersion: number;
  modeTemplates: PddModeTemplate[];
  hostMacroGlobal?: { def: string; header: string; footer: string };
  joinMacroGlobal?: { def: string; header: string; footer: string };
}

export interface PdesDesign {
  protocolDesignVersion: number;
  classification: string;
  description: string;
  policy: string | number;
  modes: { modeTemplate: string; topics: { name: string; properties: Record<string, any> }[] }[];
}

export interface PreviewResult {
  hostMacro: string;
  joinMacro: string;
  errors: string[];
}

function normalizeIdentifier(name: string, counter: Record<string, number>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const count = counter[base] ?? 0;
  counter[base] = count + 1;
  if (count === 0) {
    return base || "topic";
  }
  return `${base || "topic"}${count}`;
}

function topicIdLists(ids: { id: string; constraint?: TopicConstraint }[]) {
  const req: string[] = [];
  const ob: string[] = [];
  ids.forEach((item) => {
    if (item.constraint === "requirement") {
      req.push(item.id);
    } else if (item.constraint === "obligation") {
      ob.push(item.id);
    }
  });
  return { req, ob };
}

function buildMacro(
  global: { def: string; header: string; footer: string },
  templates: string[],
  defParams: string[],
  modeTopicIds: string[][]
) {
  const lines: string[] = [];
  lines.push(global.def.replace("$TOPICS", defParams.join(", ")));
  lines.push(global.header);
  templates.forEach((tpl, modeIdx) => {
    const ids = modeTopicIds[modeIdx] ?? [];
    const replaced = tpl.replace(/\$TOPIC_(\d+)/g, (_, n) => ids[Number(n)] ?? "");
    lines.push(replaced);
  });
  lines.push(global.footer);
  return lines.join("\n");
}

export function buildPreview(design: PdesDesign, pdd: PddDefinition | null | undefined): PreviewResult {
  if (!pdd) {
    return { hostMacro: "", joinMacro: "", errors: ["No protocol design definition loaded."] };
  }

  const errors: string[] = [];
  const modeTopicIds: string[][] = [];
  const allIds: { id: string; constraint?: TopicConstraint }[] = [];
  const counter: Record<string, number> = {};

  const hostTemplates: string[] = [];
  const joinTemplates: string[] = [];

  design.modes?.forEach((mode, modeIdx) => {
    const template = (pdd.modeTemplates || []).find((t) => t.name === mode.modeTemplate);
    if (!template) {
      errors.push(`No mode template found for "${mode.modeTemplate}"`);
      modeTopicIds.push([]);
      return;
    }
    const ids: string[] = [];
    (mode.topics || []).forEach((topicInstance, topicIdx) => {
      const templateTopic = template.topics?.[topicIdx];
      if (!templateTopic) {
        errors.push(`Topic #${topicIdx + 1} missing template in mode ${template.name}`);
        return;
      }
      const id = normalizeIdentifier(topicInstance.name ?? templateTopic.name ?? `topic${topicIdx + 1}`, counter);
      ids.push(id);
      allIds.push({ id, constraint: templateTopic.constraint });
    });
    modeTopicIds.push(ids);
    hostTemplates.push(...(template.hostMacroTemplates ?? []));
    joinTemplates.push(...(template.joinMacroTemplates ?? []));
  });

  const { req, ob } = topicIdLists(allIds);
  const defParams = [...req, ...ob];

  const hostMacro =
    pdd.hostMacroGlobal && pdd.hostMacroGlobal.def
      ? buildMacro(pdd.hostMacroGlobal, hostTemplates, defParams, modeTopicIds)
      : "";
  const joinMacro =
    pdd.joinMacroGlobal && pdd.joinMacroGlobal.def
      ? buildMacro(pdd.joinMacroGlobal, joinTemplates, defParams, modeTopicIds)
      : "";

  return { hostMacro, joinMacro, errors };
}
