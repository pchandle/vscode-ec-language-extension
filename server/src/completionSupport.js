"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCompletionItems = exports.buildProtocolSpecCompletionItems = exports.buildContractSpecCompletionItems = exports.shouldTriggerProtocolSpecCompletion = exports.shouldTriggerContractSpecCompletion = exports.getDefaultsFromText = exports.classifyProtocolName = exports.classifyContractName = void 0;
const node_1 = require("vscode-languageserver/node");
function classifyContractName(name) {
    const groups = name.match(/\/(?<layer>[^/]+)\/(?<verb>[^/]+)\/(?<subject>[^/]+)\/(?<variation>[^/]+)\/(?<platform>[^/]+)/);
    if (!groups)
        return undefined;
    return {
        layer: groups[1],
        verb: groups[2],
        subject: groups[3],
        variation: groups[4],
        platform: groups[5],
    };
}
exports.classifyContractName = classifyContractName;
function classifyProtocolName(name) {
    const groups = name.match(/\/(?<layer>[^/]+)\/(?<subject>[^/]+)\/(?<variation>[^/]+)\/(?<platform>[^/]+)/);
    if (!groups)
        return undefined;
    return {
        layer: groups[1],
        subject: groups[2],
        variation: groups[3],
        platform: groups[4],
    };
}
exports.classifyProtocolName = classifyProtocolName;
function getDefaultsFromText(text) {
    const defaults = text.match(/(^|\n)\s*defaults:\s+(?<layer>[^ ,]*)\s*,\s*(?<variation>[^ ,]*)\s*,\s*(?<platform>[^ ,]*)\s*,\s*(?<supplier>\w*)/);
    return defaults ? defaults.groups : null;
}
exports.getDefaultsFromText = getDefaultsFromText;
function normalizeTopicName(name) {
    if (!name)
        return null;
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/gi, "_");
    return normalized || null;
}
function getLineText(document, line) {
    const rawLine = document.getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } });
    return rawLine.replace(/[\r\n]+$/, "");
}
function shouldTriggerRoleSpecCompletion(document, position, keywords) {
    const lineText = getLineText(document, position.line);
    const keywordMatch = lineText.match(new RegExp(`^\\s*(${keywords.join("|")})\\s+`, "i"));
    if (!keywordMatch) {
        return null;
    }
    const keyword = keywordMatch[1].toLowerCase();
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
function shouldTriggerContractSpecCompletion(document, position) {
    return shouldTriggerRoleSpecCompletion(document, position, ["sub", "job"]);
}
exports.shouldTriggerContractSpecCompletion = shouldTriggerContractSpecCompletion;
function shouldTriggerProtocolSpecCompletion(document, position) {
    return shouldTriggerRoleSpecCompletion(document, position, ["host", "join"]);
}
exports.shouldTriggerProtocolSpecCompletion = shouldTriggerProtocolSpecCompletion;
function buildContractSpecCompletionItems(spec, position, lineText, openParenIndex, keyword) {
    const requirements = (spec.requirements ?? []).map((req) => normalizeTopicName(req.name)).filter(Boolean);
    const obligations = (spec.obligations ?? []).map((obl) => normalizeTopicName(obl.name)).filter(Boolean);
    const requirementText = requirements.join(", ");
    const obligationText = obligations.join(", ");
    let completionText;
    let newText;
    if (keyword === "job") {
        completionText = `${requirementText}) ${obligationText}:`.trimEnd();
        newText = completionText || ") :";
    }
    else {
        completionText = `${requirementText}) -> ${obligationText}`.trimEnd();
        newText = completionText || ") -> ";
    }
    const editRange = {
        start: { line: position.line, character: openParenIndex + 1 },
        end: { line: position.line, character: lineText.length },
    };
    return [
        {
            label: completionText || ") ->",
            kind: node_1.CompletionItemKind.Snippet,
            preselect: true,
            sortText: "emergent_completion_000_spec",
            textEdit: { range: editRange, newText },
            insertText: newText,
        },
    ];
}
exports.buildContractSpecCompletionItems = buildContractSpecCompletionItems;
function buildProtocolSpecCompletionItems(spec, position, lineText, openParenIndex, keyword) {
    const roleSpec = keyword === "host" ? spec.host : spec.join;
    if (!roleSpec) {
        return null;
    }
    const requirements = (roleSpec.requirements ?? []).map((req) => normalizeTopicName(req.name)).filter(Boolean);
    const obligations = (roleSpec.obligations ?? []).map((obl) => normalizeTopicName(obl.name)).filter(Boolean);
    const requirementText = requirements.join(", ");
    const obligationText = obligations.join(", ");
    const completionText = `${requirementText}) -> ${obligationText}`.trimEnd();
    const newText = completionText || ") -> ";
    const editRange = {
        start: { line: position.line, character: openParenIndex + 1 },
        end: { line: position.line, character: lineText.length },
    };
    return [
        {
            label: completionText || ") ->",
            kind: node_1.CompletionItemKind.Snippet,
            preselect: true,
            sortText: "emergent_completion_000_spec",
            textEdit: { range: editRange, newText },
            insertText: newText,
        },
    ];
}
exports.buildProtocolSpecCompletionItems = buildProtocolSpecCompletionItems;
function buildContractCompletionItems(contracts, document, position) {
    const lineRange = { start: { line: position.line, character: 0 }, end: position };
    const lineText = document.getText(lineRange);
    const keywordMatch = lineText.match(/^\s*(sub|job)\s+/);
    if (!keywordMatch) {
        return [];
    }
    const restOfLine = lineText.slice(keywordMatch[0].length);
    const delimiterIdx = restOfLine.search(/[\s(@]/); // first whitespace, '(' or '@'
    const classificationEnd = delimiterIdx === -1 ? lineText.length : keywordMatch[0].length + delimiterIdx;
    if (position.character > classificationEnd) {
        return [];
    }
    const fullText = document.getText();
    const defaults = getDefaultsFromText(fullText) || { layer: "", variation: "", platform: "", supplier: "" };
    const classificationText = lineText.slice(0, classificationEnd);
    const taxonomy = classificationText.match(/^\s*(sub|job) +(\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?(?:\/([^/@(]*))?(?:\/([^/@(]*))?@?([^(]*)?$/);
    const layer = taxonomy?.[3];
    const verb = taxonomy?.[4];
    const subject = taxonomy?.[5];
    const variation = taxonomy?.[6];
    const platform = taxonomy?.[7];
    const variationProvided = taxonomy ? taxonomy[6] !== undefined : false;
    const platformProvided = taxonomy ? taxonomy[7] !== undefined && taxonomy[7] !== "" : false;
    const searchLayer = layer === undefined ? defaults.layer : layer === "." ? defaults.layer : layer;
    const searchVariation = variation === undefined ? defaults.variation : variation === "." ? defaults.variation : variation;
    const searchPlatform = platform === undefined || platform === "" ? defaults.platform : platform === "." ? defaults.platform : platform;
    const layerMatches = (itemLayer) => !searchLayer || itemLayer === searchLayer;
    const completionItems = [];
    contracts.forEach((item) => {
        if (!verb && !subject && !variation && !platform) {
            if (layerMatches(item.layer)) {
                completionItems.push(item.verb);
            }
            else {
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
            if (layerMatches(item.layer) &&
                item.verb === verb &&
                item.subject === subject &&
                item.variation.startsWith(searchVariation ?? "")) {
                const prefix = (layer ? `/${layer}/` : "") + verb + "/" + subject + "/" + item.variation;
                completionItems.push(prefix);
                completionItems.push(prefix + "/" + item.platform);
            }
            return;
        }
        if (verb && subject && variationProvided && platformProvided) {
            if (layerMatches(item.layer) &&
                item.verb === verb &&
                item.subject === subject &&
                (searchVariation ? item.variation === searchVariation : true) &&
                item.platform.startsWith(searchPlatform)) {
                const prefix = (layer ? `/${layer}/` : "") +
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
        kind: node_1.CompletionItemKind.Text,
        preselect: idx === 0,
        sortText: `emergent_completion_${idx}`,
    }));
}
function buildProtocolCompletionItems(protocols, document, position) {
    const lineRange = { start: { line: position.line, character: 0 }, end: position };
    const lineText = document.getText(lineRange);
    const keywordMatch = lineText.match(/^\s*(host|join)\s+/);
    if (!keywordMatch) {
        return [];
    }
    const restOfLine = lineText.slice(keywordMatch[0].length);
    const delimiterIdx = restOfLine.search(/[\s(@]/); // first whitespace, '(' or '@'
    const classificationEnd = delimiterIdx === -1 ? lineText.length : keywordMatch[0].length + delimiterIdx;
    if (position.character > classificationEnd) {
        return [];
    }
    const fullText = document.getText();
    const defaults = getDefaultsFromText(fullText) || { layer: "", variation: "", platform: "", supplier: "" };
    const classificationText = lineText.slice(0, classificationEnd);
    const taxonomy = classificationText.match(/^\s*(host|join)\s+(?:\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?\/?([^/@(]*)?@?([^(]*)?$/);
    const layer = taxonomy?.[2];
    const subject = taxonomy?.[3];
    const variation = taxonomy?.[4];
    const platform = taxonomy?.[5];
    const variationProvided = taxonomy ? taxonomy[4] !== undefined : false;
    const platformProvided = taxonomy ? taxonomy[5] !== undefined : false;
    const searchLayer = layer === undefined ? defaults.layer : layer === "." ? defaults.layer : layer;
    const searchVariation = variation === undefined ? defaults.variation : variation === "." ? defaults.variation : variation;
    const searchPlatform = platform === undefined ? defaults.platform : platform === "." ? defaults.platform : platform;
    const layerMatches = (itemLayer) => !searchLayer || itemLayer === searchLayer;
    const completionItems = [];
    protocols.forEach((item) => {
        if (!subject && !variation && !platform) {
            if (layerMatches(item.layer)) {
                completionItems.push(item.subject);
            }
            else {
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
            if (layerMatches(item.layer) &&
                item.subject === subject &&
                (searchVariation ? item.variation === searchVariation : true) &&
                item.platform.startsWith(searchPlatform)) {
                const prefix = (layer ? `/${layer}/` : "") +
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
        kind: node_1.CompletionItemKind.Text,
        preselect: idx === 0,
        sortText: `emergent_completion_${idx}`,
    }));
}
function buildCompletionItems(contracts, protocols, document, position) {
    const lineRange = { start: { line: position.line, character: 0 }, end: position };
    const lineText = document.getText(lineRange);
    if (/^\s*(sub|job)\s/.test(lineText)) {
        return buildContractCompletionItems(contracts, document, position);
    }
    if (/^\s*(host|join)\s/.test(lineText)) {
        return buildProtocolCompletionItems(protocols, document, position);
    }
    return [];
}
exports.buildCompletionItems = buildCompletionItems;
//# sourceMappingURL=completionSupport.js.map