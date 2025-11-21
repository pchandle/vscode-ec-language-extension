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

export function getDefaultsFromText(text: string) {
  const defaults = text.match(
    /(^|\n)\s*defaults:\s+(?<layer>[^ ,]*)\s*,\s*(?<variation>[^ ,]*)\s*,\s*(?<platform>[^ ,]*)\s*,\s*(?<supplier>\w*)/
  );
  return defaults ? (defaults.groups as any) : null;
}

export function buildCompletionItems(
  contracts: ContractClassification[],
  document: TextDocument,
  position: Position
): CompletionItem[] {
  const lineRange: Range = { start: { line: position.line, character: 0 }, end: position };
  const lineText = document.getText(lineRange);

  if (!/^\s*sub\s/.test(lineText)) {
    return [];
  }

  const fullText = document.getText();
  const defaults = getDefaultsFromText(fullText) || { layer: "", variation: "", platform: "", supplier: "" };

  const taxonomy = lineText.match(/^\s*sub +(\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?\/?([^/@(]*)?\/?([^/@(]*)?@?([^(]*)?$/);
  const layer = taxonomy?.[2];
  const verb = taxonomy?.[3];
  const subject = taxonomy?.[4];
  const variation = taxonomy?.[5];
  const platform = taxonomy?.[6];

  const searchLayer = layer === undefined ? defaults.layer : layer === "." ? defaults.layer : layer;
  const searchVariation = variation === undefined ? defaults.variation : variation === "." ? defaults.variation : variation;
  const searchPlatform = platform === undefined ? defaults.platform : platform === "." ? defaults.platform : platform;

  const completionItems: string[] = [];

  contracts.forEach((item) => {
    if (!verb && !subject && !variation && !platform) {
      if (item.layer === searchLayer) {
        completionItems.push(item.verb);
      } else {
        completionItems.push(`/${item.layer}/`);
      }
      return;
    }

    if (verb && !subject) {
      if (item.layer === searchLayer && item.verb.startsWith(verb)) {
        completionItems.push((layer ? `/${layer}/` : "") + item.verb);
      }
      if (item.layer === searchLayer && item.verb === verb) {
        completionItems.push((layer ? `/${layer}/` : "") + item.verb + "/" + item.subject);
      }
      return;
    }

    if (verb && subject && !variation && !platform) {
      if (
        item.layer === searchLayer &&
        item.verb === verb &&
        item.subject.startsWith(subject) &&
        item.variation === searchVariation &&
        item.platform === searchPlatform
      ) {
        const prefix = (layer ? `/${layer}/` : "") + verb + "/" + item.subject;
        completionItems.push(prefix);
      }
      return;
    }

    if (verb && subject && variation && !platform) {
      if (item.layer === searchLayer && item.verb === verb && item.subject === subject && item.variation.startsWith(searchVariation)) {
        const prefix = (layer ? `/${layer}/` : "") + verb + "/" + subject + "/" + item.variation;
        completionItems.push(prefix);
      }
      return;
    }

    if (verb && subject && variation && platform) {
      if (
        item.layer === searchLayer &&
        item.verb === verb &&
        item.subject === subject &&
        item.variation === searchVariation &&
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
