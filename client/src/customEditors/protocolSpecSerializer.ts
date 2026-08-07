import { findNodeAtLocation, parseTree } from "jsonc-parser";

const SIGNED_DECIMAL_INTEGER = /^-?\d+$/;

/**
 * Serializes a protocol specification with a valid policy emitted as a raw JSON
 * integer. The policy remains a string in memory so it is never rounded by a
 * JavaScript Number before this final serialization step.
 */
export function serializeProtocolSpecification(value: unknown): string {
  const json = JSON.stringify(value ?? {}, null, 2);
  const canonicalPolicy = canonicalPolicyValue(value);
  if (!canonicalPolicy) {
    return json;
  }

  const tree = parseTree(json);
  const policyNode = tree ? findNodeAtLocation(tree, ["policy"]) : undefined;
  if (!policyNode || policyNode.type !== "string") {
    return json;
  }

  return json.slice(0, policyNode.offset) + canonicalPolicy + json.slice(policyNode.offset + policyNode.length);
}

function canonicalPolicyValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || (value as any).type !== "protocol") {
    return undefined;
  }
  const policy = (value as any).policy;
  if (typeof policy !== "string") {
    return undefined;
  }
  const trimmed = policy.trim();
  return SIGNED_DECIMAL_INTEGER.test(trimmed) ? BigInt(trimmed).toString() : undefined;
}
