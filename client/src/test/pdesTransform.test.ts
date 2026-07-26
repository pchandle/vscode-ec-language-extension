import * as assert from "assert";
import { transformPdesToPspec } from "../pdes/transform";
import { ProtocolDesignDefinition } from "../pddLoader";

const pdd: ProtocolDesignDefinition = {
  protocolDesignVersion: 1,
  hostMacroGlobal: { def: "def (host: $TOPICS, self)", header: "host {", footer: "}" },
  joinMacroGlobal: { def: "def (join: self, $TOPICS)", header: "join {", footer: "}" },
  modeTemplates: [
    {
      name: "group-peers",
      topics: [
        { name: "hosted group", role: "host", constraint: "requirement", type: "abstraction" },
        { name: "joined group", role: "join", constraint: "obligation", type: "abstraction" },
      ],
      hostMacroTemplates: ["host($TOPIC_0)"],
      joinMacroTemplates: ["join($TOPIC_1)"],
    },
    {
      name: "mixed",
      topics: [
        { name: "host requirement", role: "host", constraint: "requirement", type: "integer" },
        { name: "host obligation", role: "host", constraint: "obligation", type: "integer" },
        { name: "join requirement", role: "join", constraint: "requirement", type: "integer" },
        { name: "join obligation", role: "join", constraint: "obligation", type: "integer" },
      ],
      hostMacroTemplates: ["host($TOPIC_0, $TOPIC_1)"],
      joinMacroTemplates: ["join($TOPIC_2, $TOPIC_3)"],
    },
  ],
};

function design(modes: any[], policy: string | number = 0) {
  return {
    protocolDesignVersion: 1,
    classification: "/system/example/default/x64",
    description: "Example",
    policy,
    modes,
  };
}

function mode(modeTemplate: string, collaborationLabel: string, topicCount: number) {
  return {
    modeTemplate,
    collaborationLabel,
    topics: Array.from({ length: topicCount }, (_, index) => ({
      name: `template topic ${index}`,
      properties: { protocol: `/data/example-${index}/default/x64` },
    })),
  };
}

suite("PDES transform", () => {
  test("exports collaboration labels, implicit self endpoints, and side-local macros", () => {
    const result = transformPdesToPspec(
      design([mode("group-peers", "sysinit", 2), mode("group-peers", "log man", 2), mode("mixed", "allocate tickets", 4)]),
      pdd
    );

    assert.deepEqual(result.errors, []);
    assert.ok(result.pspec);
    const pspec = result.pspec!;
    assert.equal(pspec.policy, "0");
    assert.deepEqual(pspec.host.requirements.map((topic) => topic.name), ["sysinit", "log man", "allocate tickets"]);
    assert.deepEqual(pspec.host.obligations.map((topic) => topic.name), ["allocate tickets", "<self>"]);
    assert.deepEqual(pspec.join.requirements.map((topic) => topic.name), ["allocate tickets", "<self>"]);
    assert.deepEqual(pspec.join.obligations.map((topic) => topic.name), ["sysinit", "log man", "allocate tickets"]);
    assert.deepEqual(pspec.host.obligations[pspec.host.obligations.length - 1], {
      type: "abstraction",
      name: "<self>",
      protocol: "/system/example/default/x64",
    });
    assert.deepEqual(
      pspec.join.requirements[pspec.join.requirements.length - 1],
      pspec.host.obligations[pspec.host.obligations.length - 1]
    );
    assert.match(pspec.host.macro, /^def \(host: sysinit, log_man, allocate_tickets, allocate_tickets1, self\)/);
    assert.match(pspec.join.macro, /^def \(join: self, allocate_tickets, sysinit, log_man, allocate_tickets1\)/);
    assert.ok(!pspec.host.macro.includes("joined_group"));
    assert.ok(!pspec.join.macro.includes("hosted_group"));
    assert.match(pspec.host.macro, /host\(allocate_tickets, allocate_tickets1\)/);
    assert.match(pspec.join.macro, /join\(allocate_tickets, allocate_tickets1\)/);
  });

  test("uses stable suffixes for repeated collaboration labels", () => {
    const result = transformPdesToPspec(design([mode("group-peers", "same label", 2), mode("group-peers", "same label", 2)]), pdd);

    assert.ok(result.pspec);
    assert.match(result.pspec!.host.macro, /^def \(host: same_label, same_label1, self\)/);
    assert.match(result.pspec!.join.macro, /^def \(join: self, same_label, same_label1\)/);
  });

  test("exports canonical numeric-string policies", () => {
    const modes = [mode("group-peers", "label", 2)];

    assert.equal(transformPdesToPspec(design(modes, " 004 "), pdd).pspec!.policy, "4");
    assert.equal(transformPdesToPspec(design(modes, 3.8), pdd).pspec!.policy, "3");
    assert.equal(transformPdesToPspec(design(modes, "not a policy"), pdd).pspec!.policy, "0");
  });

  test("rejects blank collaboration labels", () => {
    const invalidDesign = design([mode("group-peers", "  ", 2)]);
    const result = transformPdesToPspec(invalidDesign, pdd);

    assert.equal(result.pspec, undefined);
    assert.match(result.errors![0].message, /Mode #1 \(group-peers\) requires a non-blank collaboration label/);
  });
});
