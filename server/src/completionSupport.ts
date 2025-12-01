import { CompletionItem, CompletionItemKind } from "vscode-languageserver/node";
import { Position, Range, TextDocument } from "vscode-languageserver-textdocument";

export type ContractClassification = {
  layer: string;
  verb: string;
  subject: string;
  variation: string;
  platform: string;
  suppliers?: string[];
};

export type ProtocolClassification = {
  layer: string;
  subject: string;
  variation: string;
  platform: string;
  suppliers?: string[];
};

export type ContractSpecTopic = { name?: string };
export type ContractSpecification = {
  requirements?: ContractSpecTopic[];
  obligations?: ContractSpecTopic[];
};
export type ProtocolRoleSpec = {
  requirements?: ContractSpecTopic[];
  obligations?: ContractSpecTopic[];
};
export type ProtocolSpecification = {
  host?: ProtocolRoleSpec;
  join?: ProtocolRoleSpec;
};

export function classifyContractName(name: string): ContractClassification | undefined {
  const groups = name.match(/\/(?<layer>[^/]+)\/(?<verb>[^/]+)\/(?<subject>[^/]+)\/(?<variation>[^/]+)\/(?<platform>[^/]+)/);
  if (!groups) return undefined;
  return {
    layer: groups[1],
    verb: groups[2],
    subject: groups[3],
    variation: groups[4],
    platform: groups[5],
  };
}

export function classifyProtocolName(name: string): ProtocolClassification | undefined {
  const groups = name.match(/\/(?<layer>[^/]+)\/(?<subject>[^/]+)\/(?<variation>[^/]+)\/(?<platform>[^/]+)/);
  if (!groups) return undefined;
  return {
    layer: groups[1],
    subject: groups[2],
    variation: groups[3],
    platform: groups[4],
  };
}

export function getDefaultsFromText(text: string) {
  const defaults = text.match(
    /(^|\n)\s*defaults:\s+(?<layer>[^ ,]*)\s*,\s*(?<variation>[^ ,]*)\s*,\s*(?<platform>[^ ,]*)\s*,\s*(?<supplier>\w*)/
  );
  return defaults ? (defaults.groups as any) : null;
}

function normalizeTopicName(name?: string): string | null {
  if (!name) return null;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/gi, "_");
  return normalized || null;
}

function getLineText(document: TextDocument, line: number): string {
  const rawLine = document.getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } });
  return rawLine.replace(/[\r\n]+$/, "");
}

function shouldTriggerRoleSpecCompletion<K extends string>(
  document: TextDocument,
  position: Position,
  keywords: readonly K[]
): { lineText: string; openParenIndex: number; keyword: K } | null {
  const lineText = getLineText(document, position.line);
  const keywordMatch = lineText.match(new RegExp(`^\\s*(${keywords.join("|")})\\s+`, "i"));
  if (!keywordMatch) {
    return null;
  }
  const keyword = keywordMatch[1].toLowerCase() as K;

  const openParenIndex = lineText.indexOf("(");
  if (openParenIndex === -1 || position.character <= openParenIndex) {
    return null;
  }

  const beforeCursor = lineText.slice(openParenIndex + 1, position.character);
  if (beforeCursor.trim() !== "") {
    return null;
  }

  const afterCursor = lineText.slice(position.character);
  const afterCursorTrimmed = afterCursor.trim();
  if (afterCursorTrimmed !== "" && afterCursorTrimmed !== ")") {
    return null;
  }

  return { lineText, openParenIndex, keyword };
}

export function shouldTriggerContractSpecCompletion(
  document: TextDocument,
  position: Position
): { lineText: string; openParenIndex: number; keyword: "sub" | "job" } | null {
  return shouldTriggerRoleSpecCompletion(document, position, ["sub", "job"] as const);
}

export function shouldTriggerProtocolSpecCompletion(
  document: TextDocument,
  position: Position
): { lineText: string; openParenIndex: number; keyword: "host" | "join" } | null {
  return shouldTriggerRoleSpecCompletion(document, position, ["host", "join"] as const);
}

export function buildContractSpecCompletionItems(
  spec: ContractSpecification,
  position: Position,
  lineText: string,
  openParenIndex: number,
  keyword: "sub" | "job"
): CompletionItem[] | null {
  const requirements = (spec.requirements ?? []).map((req) => normalizeTopicName(req.name)).filter(Boolean) as string[];
  const obligations = (spec.obligations ?? []).map((obl) => normalizeTopicName(obl.name)).filter(Boolean) as string[];

  const requirementText = requirements.join(", ");
  const obligationText = obligations.join(", ");

  let completionText: string;
  let newText: string;
  if (keyword === "job") {
    completionText = `${requirementText}) ${obligationText}:`.trimEnd();
    newText = completionText || ") :";
  } else {
    completionText = `${requirementText}) -> ${obligationText}`.trimEnd();
    newText = completionText || ") -> ";
  }

  const editRange: Range = {
    start: { line: position.line, character: openParenIndex + 1 },
    end: { line: position.line, character: lineText.length },
  };

  return [
    {
      label: completionText || ") ->",
      kind: CompletionItemKind.Snippet,
      preselect: true,
      sortText: "emergent_completion_000_spec",
      textEdit: { range: editRange, newText },
      insertText: newText,
    },
  ];
}

export function buildProtocolSpecCompletionItems(
  spec: ProtocolSpecification,
  position: Position,
  lineText: string,
  openParenIndex: number,
  keyword: "host" | "join"
): CompletionItem[] | null {
  const roleSpec = keyword === "host" ? spec.host : spec.join;
  if (!roleSpec) {
    return null;
  }

  const requirements = (roleSpec.requirements ?? []).map((req) => normalizeTopicName(req.name)).filter(Boolean) as string[];
  const obligations = (roleSpec.obligations ?? []).map((obl) => normalizeTopicName(obl.name)).filter(Boolean) as string[];

  const requirementText = requirements.join(", ");
  const obligationText = obligations.join(", ");
  const completionText = `${requirementText}) -> ${obligationText}`.trimEnd();
  const newText = completionText || ") -> ";

  const editRange: Range = {
    start: { line: position.line, character: openParenIndex + 1 },
    end: { line: position.line, character: lineText.length },
  };

  return [
    {
      label: completionText || ") ->",
      kind: CompletionItemKind.Snippet,
      preselect: true,
      sortText: "emergent_completion_000_spec",
      textEdit: { range: editRange, newText },
      insertText: newText,
    },
  ];
}

function buildContractCompletionItems(
  contracts: ContractClassification[],
  document: TextDocument,
  position: Position
): CompletionItem[] {
  const lineRange: Range = { start: { line: position.line, character: 0 }, end: position };
  const lineText = document.getText(lineRange);

  const keywordMatch = lineText.match(/^\s*(sub|job)\s+/);
  if (!keywordMatch) {
    return [];
  }

  const restOfLine = lineText.slice(keywordMatch[0].length);
  const delimiterIdx = restOfLine.search(/[\s(@]/); // first whitespace, '(' or '@'
  const classificationEnd =
    delimiterIdx === -1 ? lineText.length : keywordMatch[0].length + delimiterIdx;

  if (position.character > classificationEnd) {
    return [];
  }

  const fullText = document.getText();
  const defaults = getDefaultsFromText(fullText) || { layer: "", variation: "", platform: "", supplier: "" };

  const classificationText = lineText.slice(0, classificationEnd);
  const taxonomy = classificationText.match(
    /^\s*(sub|job) +(\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?(?:\/([^/@(]*))?(?:\/([^/@(]*))?@?([^(]*)?$/
  );
  const layer = taxonomy?.[3];
  const verb = taxonomy?.[4];
  const subject = taxonomy?.[5];
  const variation = taxonomy?.[6];
  const platform = taxonomy?.[7];
  const variationProvided = taxonomy ? taxonomy[6] !== undefined : false;
  const platformProvided = taxonomy ? taxonomy[7] !== undefined && taxonomy[7] !== "" : false;

  const searchLayer = layer === undefined ? defaults.layer : layer === "." ? defaults.layer : layer;
  const searchVariation = variation === undefined ? defaults.variation : variation === "." ? defaults.variation : variation;
  const searchPlatform =
    platform === undefined || platform === "" ? defaults.platform : platform === "." ? defaults.platform : platform;
  const layerMatches = (itemLayer: string) => !searchLayer || itemLayer === searchLayer;

  const completionItems: string[] = [];

  contracts.forEach((item) => {
    if (!verb && !subject && !variation && !platform) {
      if (layerMatches(item.layer)) {
        completionItems.push(item.verb);
      } else {
        completionItems.push(`/${item.layer}/`);
      }
      return;
    }

    if (verb && !subject) {
      if (layerMatches(item.layer) && item.verb.startsWith(verb)) {
        completionItems.push((layer ? `/${layer}/` : "") + item.verb);
      }
      if (layerMatches(item.layer) && item.verb === verb) {
        completionItems.push((layer ? `/${layer}/` : "") + item.verb + "/" + item.subject);
      }
      return;
    }

    if (verb && subject && !variationProvided && !platformProvided) {
      if (layerMatches(item.layer) && item.verb === verb && item.subject.startsWith(subject)) {
        const prefix = (layer ? `/${layer}/` : "") + verb + "/" + item.subject;
        completionItems.push(prefix);
      }
      return;
    }

    if (verb && subject && variationProvided && !platformProvided) {
      if (
        layerMatches(item.layer) &&
        item.verb === verb &&
        item.subject === subject &&
        item.variation.startsWith(searchVariation ?? "")
      ) {
        const prefix = (layer ? `/${layer}/` : "") + verb + "/" + subject + "/" + item.variation;
        completionItems.push(prefix);
        completionItems.push(prefix + "/" + item.platform);
      }
      return;
    }

    if (verb && subject && variationProvided && platformProvided) {
      if (
        layerMatches(item.layer) &&
        item.verb === verb &&
        item.subject === subject &&
        (searchVariation ? item.variation === searchVariation : true) &&
        item.platform.startsWith(searchPlatform)
      ) {
        const prefix =
          (layer ? `/${layer}/` : "") +
          verb +
          "/" +
          subject +
          "/" +
          (searchVariation === defaults.variation ? "." : item.variation) +
          "/" +
          item.platform;
        completionItems.push(prefix);
      }
    }
  });

  const uniq = Array.from(new Set(completionItems));

  return uniq.map((label, idx) => ({
    label,
    kind: CompletionItemKind.Text,
    preselect: idx === 0,
    sortText: `emergent_completion_${idx}`,
  }));
}

function buildProtocolCompletionItems(
  protocols: ProtocolClassification[],
  document: TextDocument,
  position: Position
): CompletionItem[] {
  const lineRange: Range = { start: { line: position.line, character: 0 }, end: position };
  const lineText = document.getText(lineRange);

  const keywordMatch = lineText.match(/^\s*(host|join)\s+/);
  if (!keywordMatch) {
    return [];
  }

  const restOfLine = lineText.slice(keywordMatch[0].length);
  const delimiterIdx = restOfLine.search(/[\s(@]/); // first whitespace, '(' or '@'
  const classificationEnd =
    delimiterIdx === -1 ? lineText.length : keywordMatch[0].length + delimiterIdx;

  if (position.character > classificationEnd) {
    return [];
  }

  const fullText = document.getText();
  const defaults = getDefaultsFromText(fullText) || { layer: "", variation: "", platform: "", supplier: "" };

  const classificationText = lineText.slice(0, classificationEnd);
  const taxonomy = classificationText.match(
    /^\s*(host|join)\s+(?:\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?\/?([^/@(]*)?@?([^(]*)?$/
  );
  const layer = taxonomy?.[2];
  const subject = taxonomy?.[3];
  const variation = taxonomy?.[4];
  const platform = taxonomy?.[5];
  const variationProvided = taxonomy ? taxonomy[4] !== undefined : false;
  const platformProvided = taxonomy ? taxonomy[5] !== undefined : false;

  const searchLayer = layer === undefined ? defaults.layer : layer === "." ? defaults.layer : layer;
  const searchVariation = variation === undefined ? defaults.variation : variation === "." ? defaults.variation : variation;
  const searchPlatform = platform === undefined ? defaults.platform : platform === "." ? defaults.platform : platform;
  const layerMatches = (itemLayer: string) => !searchLayer || itemLayer === searchLayer;

  const completionItems: string[] = [];

  protocols.forEach((item) => {
    if (!subject && !variation && !platform) {
      if (layerMatches(item.layer)) {
        completionItems.push(item.subject);
      } else {
        completionItems.push(`/${item.layer}/`);
      }
      return;
    }

    if (subject && !variationProvided && !platformProvided) {
      if (layerMatches(item.layer) && item.subject.startsWith(subject)) {
        completionItems.push((layer ? `/${layer}/` : "") + item.subject);
      }
      if (layerMatches(item.layer) && item.subject === subject) {
        completionItems.push((layer ? `/${layer}/` : "") + item.subject + "/" + item.variation);
      }
      return;
    }

    if (subject && variationProvided && !platformProvided) {
      if (layerMatches(item.layer) && item.subject === subject && item.variation.startsWith(searchVariation ?? "")) {
        const prefix = (layer ? `/${layer}/` : "") + subject + "/" + item.variation;
        completionItems.push(prefix);
        completionItems.push(prefix + "/" + item.platform);
      }
      return;
    }

    if (subject && variationProvided && platformProvided) {
      if (
        layerMatches(item.layer) &&
        item.subject === subject &&
        (searchVariation ? item.variation === searchVariation : true) &&
        item.platform.startsWith(searchPlatform)
      ) {
        const prefix =
          (layer ? `/${layer}/` : "") +
          subject +
          "/" +
          (searchVariation === defaults.variation ? "." : item.variation) +
          "/" +
          item.platform;
        completionItems.push(prefix);
      }
    }
  });

  const uniq = Array.from(new Set(completionItems));

  return uniq.map((label, idx) => ({
    label,
    kind: CompletionItemKind.Text,
    preselect: idx === 0,
    sortText: `emergent_completion_${idx}`,
  }));
}

export function buildCompletionItems(
  contracts: ContractClassification[],
  protocols: ProtocolClassification[],
  document: TextDocument,
  position: Position
): CompletionItem[] {
  const lineRange: Range = { start: { line: position.line, character: 0 }, end: position };
  const lineText = document.getText(lineRange);

  if (/^\s*(sub|job)\s/.test(lineText)) {
    return buildContractCompletionItems(contracts, document, position);
  }

  if (/^\s*(host|join)\s/.test(lineText)) {
    return buildProtocolCompletionItems(protocols, document, position);
  }

  return [];
}
