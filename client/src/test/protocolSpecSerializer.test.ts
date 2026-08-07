import * as assert from "assert";
import { serializeProtocolSpecification } from "../customEditors/protocolSpecSerializer";

function protocol(policy: unknown) {
  return {
    type: "protocol",
    policy,
    name: "/layer/subject/variation/platform",
    description: "policy test",
    host: { requirements: [], obligations: [], macro: "" },
    join: { requirements: [], obligations: [], macro: "" },
  };
}

suite("protocol specification serializer", () => {
  test("emits exact canonical raw integer policies", () => {
    for (const [input, expected] of [
      ["-9223372036854775808", "-9223372036854775808"],
      ["9223372036854775807", "9223372036854775807"],
      ["123456789012345678901234567890", "123456789012345678901234567890"],
      [" 004 ", "4"],
    ]) {
      const serialized = serializeProtocolSpecification(protocol(input));
      assert.match(serialized, new RegExp(`"policy": ${expected}`));
      assert.ok(!serialized.includes(`"policy": "${expected}"`));
    }
  });

  test("preserves invalid policy text as a JSON string", () => {
    const serialized = serializeProtocolSpecification(protocol("1.5"));
    assert.match(serialized, /"policy": "1\.5"/);
  });
});
