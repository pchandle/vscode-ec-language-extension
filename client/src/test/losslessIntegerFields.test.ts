import * as assert from "assert";
import { parseTree } from "jsonc-parser";
import { restoreLosslessIntegerFields } from "../customEditors/losslessIntegerFields";

const MIN = "-9223372036854775808";
const MAX = "9223372036854775807";
const LARGER = "123456789012345678901234567890";

function parseLosslessly(text: string, kind: "specification" | "protocolDesign") {
  const value = JSON.parse(text);
  restoreLosslessIntegerFields(text, value, parseTree(text) ?? undefined, kind);
  return value;
}

function jsonWithIntegerLiterals(value: unknown): string {
  return JSON.stringify(value)
    .replace(/"__MIN__"/g, MIN)
    .replace(/"__MAX__"/g, MAX)
    .replace(/"__LARGER__"/g, LARGER);
}

suite("lossless specification integer fields", () => {
  test("preserves contract bounds as decimal strings", () => {
    const value = parseLosslessly(
      jsonWithIntegerLiterals({
        type: "supplier",
        requirements: [{ type: "integer", minimum: "__MIN__", maximum: "__MAX__" }],
        obligations: [
          { type: "integer", minimum: "__LARGER__", maximum: "__MIN__" },
          { type: "string", length: "__LARGER__" },
        ],
      }),
      "specification"
    );

    assert.equal(value.requirements[0].minimum, MIN);
    assert.equal(value.requirements[0].maximum, MAX);
    assert.equal(value.obligations[0].minimum, LARGER);
    assert.equal(value.obligations[0].maximum, MIN);
    assert.equal(value.obligations[1].length, LARGER);
    assert.match(JSON.stringify(value), new RegExp(`"maximum":"${MAX}"`));
  });

  test("preserves protocol policy and role bounds as decimal strings", () => {
    const value = parseLosslessly(
      jsonWithIntegerLiterals({
        type: "protocol",
        policy: "__LARGER__",
        host: { requirements: [{ type: "integer", minimum: "__MIN__", maximum: "__MAX__" }], obligations: [] },
        join: { requirements: [], obligations: [{ type: "integer", minimum: "__MAX__", maximum: "__MIN__" }] },
      }),
      "specification"
    );

    assert.equal(value.policy, LARGER);
    assert.equal(value.host.requirements[0].minimum, MIN);
    assert.equal(value.host.requirements[0].maximum, MAX);
    assert.equal(value.join.obligations[0].minimum, MAX);
    assert.equal(value.join.obligations[0].maximum, MIN);
  });

  test("preserves protocol-design policy and topic bounds as decimal strings", () => {
    const value = parseLosslessly(
      jsonWithIntegerLiterals({
        policy: "__LARGER__",
        modes: [{ topics: [{ properties: { minimum: "__MIN__", maximum: "__MAX__", length: "__LARGER__" } }] }],
      }),
      "protocolDesign"
    );

    assert.equal(value.policy, LARGER);
    assert.equal(value.modes[0].topics[0].properties.minimum, MIN);
    assert.equal(value.modes[0].topics[0].properties.maximum, MAX);
    assert.equal(value.modes[0].topics[0].properties.length, LARGER);
  });
});
