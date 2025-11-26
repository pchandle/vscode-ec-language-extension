import { ProtocolDesignDefinition } from "../pddLoader";

export type PdesModeTopicInstance = { name: string; properties: Record<string, any> };
export type PdesModeInstance = { modeTemplate: string; topics: PdesModeTopicInstance[] };
export type PdesDesign = {
  protocolDesignVersion: number;
  classification: string;
  description: string;
  policy: string | number;
  modes: PdesModeInstance[];
  [key: string]: unknown;
};

export type PspecRole = {
  requirements: any[];
  obligations: any[];
  macro: string;
};

export type Pspec = {
  type: "protocol";
  policy: number;
  name: string;
  description: string;
  host: PspecRole;
  join: PspecRole;
};

type TransformError = { message: string };

type TopicIdResult = {
  id: string;
  templateRole?: "host" | "join";
  templateConstraint?: "requirement" | "obligation";
  templateType?: string;
};

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

function topicIdLists(ids: TopicIdResult[]) {
  const req: string[] = [];
  const ob: string[] = [];
  ids.forEach((item) => {
    if (item.templateConstraint === "requirement") {
      req.push(item.id);
    } else if (item.templateConstraint === "obligation") {
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

export function transformPdesToPspec(
  design: PdesDesign,
  pdd: ProtocolDesignDefinition
): { pspec?: Pspec; errors?: TransformError[]; hostMacro?: string; joinMacro?: string } {
  const errors: TransformError[] = [];
  if (!pdd) {
    return { errors: [{ message: "No protocol design definition (.pdd) loaded." }] };
  }

  const modeTopicIds: string[][] = [];
  const allIds: TopicIdResult[] = [];
  const counter: Record<string, number> = {};

  const hostRequirements: any[] = [];
  const hostObligations: any[] = [];
  const joinRequirements: any[] = [];
  const joinObligations: any[] = [];

  const modeHostTemplates: string[] = [];
  const modeJoinTemplates: string[] = [];

  design.modes?.forEach((mode, modeIdx) => {
    const template = (pdd.modeTemplates || []).find((t) => t.name === mode.modeTemplate);
    if (!template) {
      errors.push({ message: `No mode template found for "${mode.modeTemplate}"` });
      modeTopicIds.push([]);
      return;
    }
    const ids: string[] = [];
    (mode.topics || []).forEach((topicInstance, topicIdx) => {
      const templateTopic = template.topics?.[topicIdx];
      if (!templateTopic) {
        errors.push({ message: `Topic #${topicIdx + 1} missing template in mode ${template.name}` });
        return;
      }
      const id = normalizeIdentifier(topicInstance.name ?? templateTopic.name ?? `topic${topicIdx + 1}`, counter);
      ids.push(id);
      allIds.push({
        id,
        templateRole: templateTopic.role,
        templateConstraint: templateTopic.constraint,
        templateType: templateTopic.type,
      });
      const specTopic: any = { type: templateTopic.type, name: topicInstance.name ?? "" };
      Object.assign(specTopic, topicInstance.properties ?? {});
      const target =
        templateTopic.role === "host"
          ? templateTopic.constraint === "requirement"
            ? hostRequirements
            : hostObligations
          : templateTopic.constraint === "requirement"
          ? joinRequirements
          : joinObligations;
      target.push(specTopic);
    });
    modeTopicIds.push(ids);
    modeHostTemplates.push(...(template.hostMacroTemplates ?? []).map((tpl) => tpl));
    modeJoinTemplates.push(...(template.joinMacroTemplates ?? []).map((tpl) => tpl));
  });

  const { req, ob } = topicIdLists(allIds);
  const defParams = [...req, ...ob];

  const hostMacro =
    pdd.hostMacroGlobal && pdd.hostMacroGlobal.def
      ? buildMacro(pdd.hostMacroGlobal, modeHostTemplates, defParams, modeTopicIds)
      : undefined;
  const joinMacro =
    pdd.joinMacroGlobal && pdd.joinMacroGlobal.def
      ? buildMacro(pdd.joinMacroGlobal, modeJoinTemplates, defParams, modeTopicIds)
      : undefined;

  const policyNumber =
    typeof design.policy === "string" && /^-?\d+$/.test(design.policy.trim())
      ? parseInt(design.policy.trim(), 10)
      : typeof design.policy === "number"
      ? Math.trunc(design.policy)
      : 0;

  const pspec: Pspec = {
    type: "protocol",
    policy: policyNumber,
    name: design.classification,
    description: design.description ?? "",
    host: {
      requirements: hostRequirements,
      obligations: hostObligations,
      macro: hostMacro ?? "",
    },
    join: {
      requirements: joinRequirements,
      obligations: joinObligations,
      macro: joinMacro ?? "",
    },
  };

  return { pspec, errors, hostMacro, joinMacro };
}
