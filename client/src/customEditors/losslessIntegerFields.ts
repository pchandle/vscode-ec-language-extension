import { findNodeAtLocation, Node as JsonNode } from "jsonc-parser";

export const SIGNED_DECIMAL_INTEGER_PATTERN = "^-?\\d+$";

export type LosslessIntegerDocumentKind = "specification" | "protocolDesign";

/**
 * Replaces selected numeric values with their original JSON token. JavaScript
 * numbers cannot exactly represent many valid architecture integers, so this
 * must happen immediately after parsing and before the value is sent to a
 * webview or written back to disk.
 */
export function restoreLosslessIntegerFields(
  text: string,
  value: unknown,
  tree: JsonNode | undefined,
  kind: LosslessIntegerDocumentKind
): void {
  if (!tree || !value || typeof value !== "object") {
    return;
  }

  if (kind === "specification") {
    restoreSpecificationIntegers(text, value as Record<string, unknown>, tree);
  } else {
    restoreProtocolDesignIntegers(text, value as Record<string, unknown>, tree);
  }
}

function restoreSpecificationIntegers(text: string, value: Record<string, unknown>, tree: JsonNode): void {
  if (value.type === "protocol") {
    restoreNumberAtPath(text, value, tree, ["policy"]);
    for (const role of ["host", "join"]) {
      restoreTopicCollection(text, value, tree, [role, "requirements"]);
      restoreTopicCollection(text, value, tree, [role, "obligations"]);
    }
    return;
  }

  restoreTopicCollection(text, value, tree, ["requirements"]);
  restoreTopicCollection(text, value, tree, ["obligations"]);
}

function restoreProtocolDesignIntegers(text: string, value: Record<string, unknown>, tree: JsonNode): void {
  restoreNumberAtPath(text, value, tree, ["policy"]);
  const modes = value.modes;
  if (!Array.isArray(modes)) {
    return;
  }

  modes.forEach((mode, modeIndex) => {
    if (!mode || typeof mode !== "object" || !Array.isArray((mode as any).topics)) {
      return;
    }
    (mode as any).topics.forEach((_topic: unknown, topicIndex: number) => {
      const prefix = ["modes", modeIndex, "topics", topicIndex, "properties"];
      restoreNumberAtPath(text, value, tree, [...prefix, "minimum"]);
      restoreNumberAtPath(text, value, tree, [...prefix, "maximum"]);
      restoreNumberAtPath(text, value, tree, [...prefix, "length"]);
    });
  });
}

function restoreTopicCollection(text: string, value: Record<string, unknown>, tree: JsonNode, path: Array<string | number>): void {
  const topics = getValueAtPath(value, path);
  if (!Array.isArray(topics)) {
    return;
  }
  topics.forEach((_topic, index) => {
    restoreNumberAtPath(text, value, tree, [...path, index, "minimum"]);
    restoreNumberAtPath(text, value, tree, [...path, index, "maximum"]);
    restoreNumberAtPath(text, value, tree, [...path, index, "length"]);
  });
}

function restoreNumberAtPath(
  text: string,
  value: Record<string, unknown>,
  tree: JsonNode,
  path: Array<string | number>
): void {
  const node = findNodeAtLocation(tree, path);
  if (!node || node.type !== "number") {
    return;
  }
  setValueAtPath(value, path, text.slice(node.offset, node.offset + node.length));
}

function getValueAtPath(value: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object") {
      return (current as Record<string | number, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function setValueAtPath(value: unknown, path: Array<string | number>, replacement: string): void {
  const parent = getValueAtPath(value, path.slice(0, -1));
  const key = path[path.length - 1];
  if (parent && typeof parent === "object" && key !== undefined) {
    (parent as Record<string | number, unknown>)[key] = replacement;
  }
}
