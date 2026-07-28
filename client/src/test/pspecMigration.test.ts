import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProtocolDesignDefinition } from "../pddLoader";
import { transformPdesToPspec } from "../pdes/transform";
import { Pspec, normalizeLegacyPspec, transformPspecToPdes } from "../pdes/migration";
import {
  canOfferPdesMigration,
  collectPspecMigrationSchemaWarnings,
  siblingPdesPath,
  writeNewPdes,
} from "../pspecMigration";

const bundledPdd = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../resources/pdd/default.pdd"), "utf8")
) as ProtocolDesignDefinition;

function propertiesFor(type: string, index: number) {
  switch (type) {
    case "abstraction":
      return { protocol: `/data/example-${index}/default/x64` };
    case "integer":
      return { minimum: index, maximum: index + 100, hint: `hint ${index}` };
    case "string":
      return { length: index + 10, hint: `hint ${index}` };
    default:
      return {};
  }
}

function designFor(templateName: string, label = `Mode ${templateName}`) {
  const template = bundledPdd.modeTemplates!.find((item) => item.name === templateName)!;
  return {
    protocolDesignVersion: bundledPdd.protocolDesignVersion,
    classification: "/data/migration/default/x64",
    description: `Migration fixture for ${templateName}`,
    policy: "0",
    modes: [
      {
        modeTemplate: templateName,
        collaborationLabel: label,
        topics: template.topics!.map((topic, index) => ({
          name: `${topic.name} editor label`,
          properties: propertiesFor(topic.type, index),
        })),
      },
    ],
  };
}

function migrateRoundTrip(templateName: string) {
  const originalDesign = designFor(templateName);
  const exported = transformPdesToPspec(originalDesign, bundledPdd);
  assert.deepEqual(exported.errors, []);
  const first = transformPspecToPdes(exported.pspec as Pspec, bundledPdd);
  const migration = transformPspecToPdes(exported.pspec as Pspec, bundledPdd, {
    modeTemplates: { 0: templateName },
    labels: { 0: originalDesign.modes[0].collaborationLabel },
  });
  assert.equal(migration.canCreate, true, `${templateName}: ${migration.issues.map((issue) => issue.message).join("; ")}`);
  assert.equal(migration.design.modes[0].modeTemplate, templateName);
  assert.deepEqual(
    migration.design.modes[0].topics.map((topic) => topic.properties),
    originalDesign.modes[0].topics.map((topic) => topic.properties)
  );
  assert.ok(first.modes[0].candidates?.includes(templateName) || first.modes[0].modeTemplate === templateName);
  const reexported = transformPdesToPspec(migration.design, bundledPdd);
  assert.deepEqual(reexported.errors, []);
  assert.deepEqual(reexported.pspec, exported.pspec);
}

suite(".pspec to .pdes migration", () => {
  test("covers every bundled v1 mode with a property-preserving round trip", () => {
    const expectedModes = [
      "collect-peer-sum-and-issue-offsets",
      "group-peers",
      "collect-peer-sum",
      "collect-peer-maximum",
      "collect-peer-minimum",
      "dictate-integer",
      "dictate-boolean",
      "dictate-string",
      "collect-boolean-or",
      "collect-boolean-and",
    ];
    assert.deepEqual(bundledPdd.modeTemplates!.map((template) => template.name), expectedModes);
    expectedModes.forEach(migrateRoundTrip);
  });

  test("requires an explicit label when a legacy mode has unequal topic names", () => {
    const original = transformPdesToPspec(designFor("group-peers", "Shared label"), bundledPdd).pspec as Pspec;
    original.host.requirements[0].name = "Host group";
    original.join.obligations[0].name = "Peer group";
    const withoutLabel = transformPspecToPdes(original, bundledPdd);
    assert.equal(withoutLabel.canCreate, false);
    assert.ok(withoutLabel.issues.some((issue) => issue.code === "label-required"));
    const withLabel = transformPspecToPdes(original, bundledPdd, { labels: { 0: "Migrated group" } });
    assert.equal(withLabel.canCreate, true);
    assert.equal(withLabel.design.modes[0].collaborationLabel, "Migrated group");
    assert.deepEqual(withLabel.design.modes[0].topics.map((topic) => topic.name), ["Host group", "Peer group"]);
    assert.ok(withLabel.issues.some((issue) => issue.code === "interface-difference"));
  });

  test("infers boolean collection modes from matching macro evidence", () => {
    const source = transformPdesToPspec(designFor("collect-boolean-or"), bundledPdd).pspec as Pspec;
    const inferred = transformPspecToPdes(source, bundledPdd);
    assert.equal(inferred.canCreate, true);
    assert.equal(inferred.modes[0].modeTemplate, "collect-boolean-or");
    assert.equal(inferred.modes[0].candidates, undefined);
    const selected = transformPspecToPdes(source, bundledPdd, { modeTemplates: { 0: "collect-boolean-or" } });
    assert.equal(selected.canCreate, true);
  });

  test("keeps combined, reordered, and repeated mode topic assignments distinct", () => {
    const group = designFor("group-peers", "Groups").modes[0];
    const sumOne = designFor("collect-peer-sum", "First sum").modes[0];
    const sumTwo = designFor("collect-peer-sum", "Second sum").modes[0];
    const originalDesign = {
      protocolDesignVersion: bundledPdd.protocolDesignVersion,
      classification: "/data/migration/default/x64",
      description: "Combined migration fixture",
      policy: "0",
      modes: [group, sumTwo, sumOne],
    };
    const exported = transformPdesToPspec(originalDesign, bundledPdd).pspec as Pspec;
    const migration = transformPspecToPdes(exported, bundledPdd, {
      modeTemplates: { 0: "group-peers", 1: "collect-peer-sum", 2: "collect-peer-sum" },
      labels: { 0: "Groups", 1: "Second sum", 2: "First sum" },
    });
    assert.equal(migration.canCreate, true, migration.issues.map((issue) => issue.message).join("; "));
    assert.deepEqual(migration.design.modes.map((mode) => mode.modeTemplate), ["group-peers", "collect-peer-sum", "collect-peer-sum"]);
    const assigned = migration.modes.flatMap((mode) => mode.sourceTopicIds);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepEqual(transformPdesToPspec(migration.design, bundledPdd).pspec, exported);
  });

  test("reports unsupported and unmatched legacy topics", () => {
    const source = transformPdesToPspec(designFor("group-peers"), bundledPdd).pspec as Pspec;
    source.host.requirements[0].type = "site";
    const migration = transformPspecToPdes(source, bundledPdd);
    assert.equal(migration.canCreate, false);
    assert.ok(migration.issues.some((issue) => issue.code === "unsupported-topic"));
    assert.ok(migration.issues.some((issue) => issue.code === "unmatched-topic"));
  });

  test("uses a matching custom protocol design definition", () => {
    const customPdd: ProtocolDesignDefinition = {
      protocolDesignVersion: 9,
      hostMacroGlobal: { def: "def ($TOPICS)", header: "host {", footer: "}" },
      joinMacroGlobal: { def: "def ($TOPICS)", header: "join {", footer: "}" },
      modeTemplates: [
        {
          name: "custom-string-and-boolean",
          topics: [
            { name: "text", role: "host", constraint: "requirement", type: "string" },
            { name: "accepted", role: "join", constraint: "obligation", type: "boolean" },
          ],
          hostMacroTemplates: ["custom-host($TOPIC_0)"],
          joinMacroTemplates: ["custom-join($TOPIC_1)"],
        },
      ],
    };
    const design = {
      protocolDesignVersion: 9,
      classification: "/data/custom/default/x64",
      description: "Custom PDD",
      policy: "0",
      modes: [
        {
          modeTemplate: "custom-string-and-boolean",
          collaborationLabel: "Custom mode",
          topics: [
            { name: "Text", properties: { length: 12, hint: "a value" } },
            { name: "Accepted", properties: {} },
          ],
        },
      ],
    };
    const source = transformPdesToPspec(design, customPdd).pspec as Pspec;
    const migration = transformPspecToPdes(source, customPdd);
    assert.equal(migration.canCreate, true);
    assert.equal(migration.design.protocolDesignVersion, 9);
    assert.equal(migration.design.modes[0].modeTemplate, "custom-string-and-boolean");
  });

  test("rejects malformed protocol specifications before proposing modes", () => {
    const migration = transformPspecToPdes({ type: "protocol" } as Pspec, bundledPdd);
    assert.equal(migration.canCreate, false);
    assert.ok(migration.issues.some((issue) => issue.code === "invalid-pspec"));
  });

  test("normalizes legacy array descriptions in memory without changing topic data", () => {
    const source = transformPdesToPspec(designFor("group-peers"), bundledPdd).pspec as Pspec;
    (source as any).description = ["First line", "Second line"];
    const normalized = normalizeLegacyPspec(source)!;
    assert.equal(normalized.description, "First line\nSecond line");
    assert.deepEqual(normalized.host.requirements, source.host.requirements);
    assert.equal(transformPspecToPdes(normalized, bundledPdd).canCreate, true);
  });

  test("does not warn for legacy macro layout or the chain_inout self alias", () => {
    const source = transformPdesToPspec(designFor("group-peers"), bundledPdd).pspec as Pspec;
    source.host.macro = source.host.macro.replace(/self/g, "chain_inout").replace(/\n/g, "\n  ");
    source.join.macro = source.join.macro.replace(/self/g, "chain_inout").replace(/\n/g, "\n  ");
    const migration = transformPspecToPdes(source, bundledPdd);
    assert.ok(!migration.issues.some((issue) => issue.code === "macro-difference"));
  });

  test("suppresses only canonical self-endpoint name schema warnings", () => {
    const source = transformPdesToPspec(designFor("group-peers"), bundledPdd).pspec as Pspec;
    const warnings = collectPspecMigrationSchemaWarnings(source, [
      { keyword: "pattern", instancePath: "/host/obligations/0/name", message: "must match pattern" },
      { keyword: "pattern", instancePath: "/join/requirements/0/name", message: "must match pattern" },
      { keyword: "pattern", instancePath: "/host/requirements/0/name", message: "must match pattern" },
    ]);
    assert.deepEqual(warnings, ["/host/requirements/0/name: must match pattern"]);
  });

  test("uses the same-basename sibling rule for action visibility", () => {
    const source = "/workspace/protocol.pspec";
    assert.equal(siblingPdesPath(source), "/workspace/protocol.pdes");
    assert.equal(canOfferPdesMigration(source, (candidate) => candidate !== "/workspace/protocol.pdes"), true);
    assert.equal(canOfferPdesMigration(source, () => true), false);
    assert.equal(canOfferPdesMigration("/workspace/protocol.cspec", () => false), false);
  });

  test("creates a target once and never overwrites a race-created sibling", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "emergent-pspec-migration-"));
    const target = path.join(directory, "protocol.pdes");
    try {
      assert.equal(await writeNewPdes(target, { created: true }), "created");
      assert.equal(await writeNewPdes(target, { overwritten: true }), "exists");
      assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { created: true });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
