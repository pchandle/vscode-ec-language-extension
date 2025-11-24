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
    /^\s*sub +(\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?(?:\/([^/@(]*))?(?:\/([^/@(]*))?@?([^(]*)?$/
  );
  const layer = taxonomy?.[2];
  const verb = taxonomy?.[3];
  const subject = taxonomy?.[4];
  const variation = taxonomy?.[5];
  const platform = taxonomy?.[6];
  const variationProvided = taxonomy ? taxonomy[5] !== undefined : false;
  const platformProvided = taxonomy ? taxonomy[6] !== undefined : false;

  const searchLayer = layer === undefined ? defaults.layer : layer === "." ? defaults.layer : layer;
  const searchVariation = variation === undefined ? defaults.variation : variation === "." ? defaults.variation : variation;
  const searchPlatform = platform === undefined ? defaults.platform : platform === "." ? defaults.platform : platform;
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
