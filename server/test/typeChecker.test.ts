import { strict as assert } from "assert";
import { parseText } from "../lang/parser";
import { resolveProgram } from "../lang/resolver";
import { TypeKind, typeCheckProgram } from "../lang/typeChecker";

describe("typeChecker", () => {
  it("parses and resolves a simple sample without syntax/resolver diagnostics", () => {
    const sample = "def foo(a) out:\n  a -> out\nend\nfoo(1) -> result";
    const { program, diagnostics: syntaxDiagnostics } = parseText(sample);
    const { diagnostics: resolverDiagnostics } = resolveProgram(program);
    assert.equal(
      syntaxDiagnostics.length + resolverDiagnostics.length,
      0,
      `Expected no syntax/resolver diagnostics, got syntax: ${syntaxDiagnostics.map((d) => d.message).join(", ")}; resolver: ${resolverDiagnostics
        .map((d) => d.message)
        .join(", ")}`
    );
  });

  it("flags operator/operand mismatches", () => {
    const text = '1 + "hi" -> out';
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Operator '+' requires")),
      `Expected type diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("checks call arity for defs", () => {
    const text = "def foo(a) r:\n  a -> r\nend\nfoo(1, 2) -> out";
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Expected 1 arguments")),
      `Expected arity diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("detects mismatched branch assignments", () => {
    const text = "if true then\n  1 -> a\nelse\n  \"s\" -> a\nend";
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Branches assign different types")),
      `Expected branch merge diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("errors on string relational comparisons", () => {
    const text = "\"a\" < \"b\" -> out";
    const { program } = parseText(text);
    const { diagnostics: typeDiagnostics } = typeCheckProgram(program);
    assert.ok(
      typeDiagnostics.some((d) => d.message.includes("Relational operators require INTEGER operands")),
      `Expected relational diagnostic, got ${typeDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("emits diagnostics and unknown types when contract spec is missing", () => {
    const text = "job /missing/spec() OUT:\nend";
    const { program } = parseText(text);
    const { diagnostics, types } = typeCheckProgram(program, { collectTypes: true });
    assert.ok(
      diagnostics.some((d) => d.message.includes("Unknown contract specification for '/missing/spec'")),
      `Expected unknown contract diagnostic, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
    const job = program.statements.find((s: any) => s.kind === "Job") as any;
    const target = job.targets[0];
    const match = types?.find(
      (t) =>
        t.range.start.line === target.range.start.line &&
        t.range.start.character === target.range.start.character &&
        t.range.end.line === target.range.end.line &&
        t.range.end.character === target.range.end.character
    );
    assert.ok(match, "expected a type entry for job target");
    assert.equal(match!.types[0].kind, TypeKind.Unknown, "expected target type to remain UNKNOWN without spec");
  });

  it("keeps obligations unknown when a missing-spec job has assignments", () => {
    const text = "job /missing/spec(x) OUT:\n  1 -> OUT\nend";
    const { program } = parseText(text);
    const { diagnostics, types } = typeCheckProgram(program, { collectTypes: true });
    assert.ok(
      diagnostics.some((d) => d.message.includes("Unknown contract specification for '/missing/spec'")),
      "expected missing spec diagnostic"
    );
    const job: any = program.statements.find((s: any) => s.kind === "Job");
    const target = job.targets[0];
    const match = types?.find(
      (t) =>
        t.range.start.line === target.range.start.line &&
        t.range.start.character === target.range.start.character &&
        t.range.end.line === target.range.end.line &&
        t.range.end.character === target.range.end.character
    );
    assert.ok(match, "expected a type entry for job target");
    assert.equal(match!.types[0].kind, TypeKind.Unknown, "expected target to stay UNKNOWN when spec is missing");
  });

  it("includes normalized classification and lookup reason in unknown spec diagnostics", () => {
    const text = "sub new/integer/subordinate($, 0, 1) -> out";
    const { program } = parseText(text);
    const defaults = { layer: "system", variation: "default", platform: "x64" };
    const normalized = "/system/new/integer/subordinate/x64";
    const { diagnostics } = typeCheckProgram(program, {
      defaults,
      specs: {},
      specLookupIssues: {
        [normalized]: "No host mapping found in root document for this classification.",
      },
    });
    const message = diagnostics.find((d) => d.message.includes("Unknown contract specification"))?.message ?? "";
    assert.ok(message.includes("resolved as '/system/new/integer/subordinate/x64'"), `unexpected diagnostic: ${message}`);
    assert.ok(
      message.includes("No host mapping found in root document for this classification."),
      `unexpected diagnostic: ${message}`
    );
  });

  it("rejects supplier qualifiers on non-sub statements", () => {
    const text = `
job /data/new/integer/default/x64@aptissio(flow, 1, 10) OUT:
end
host /data/integer/default/x64@aptissio() -> _
join /data/integer/default/x64@aptissio() -> _
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: {
        "/data/new/integer/default/x64": {
          requirements: [{ name: "flow", type: "/data/flow/default/x64" }, { name: "min", type: "integer" }, { name: "max", type: "integer" }],
          obligations: [{ name: "out", type: "/data/integer/default/x64" }],
          suppliers: ["aptissio"],
        } as any,
        "/data/integer/default/x64": {
          host: { requirements: [], obligations: [] },
          join: { requirements: [], obligations: [] },
          suppliers: ["aptissio"],
        } as any,
      },
    });
    const messages = diagnostics.map((d) => d.message);
    const supplierQualifierErrors = messages.filter((m) =>
      m.includes("Supplier qualifier '@name' is only valid for sub statements.")
    );
    assert.ok(
      supplierQualifierErrors.length >= 2,
      `expected supplier-qualifier errors for non-sub statements, got: ${messages.join(" | ")}`
    );
  });

  it("validates requirement and obligation counts against the spec", () => {
    const spec = {
      requirements: [
        { name: "flow", type: "/data/flow/default/x64" },
        { name: "min", type: "integer" },
        { name: "max", type: "integer" }
      ],
      obligations: [{ type: "/data/integer/default/x64" }]
    };
    const text = `
sub /data/new/integer/default/x64(1, 10) -> OUTER_INT
sub /data/new/integer/default/x64(flow, 1, 10) -> OUTER_INT2, _
sub /data/new/integer/default/x64(flow, 1, 10)
sub /data/new/integer/default/x64(flow, 1, 10, 255)
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/data/new/integer/default/x64": spec as any }
    });
    const reqErrors = diagnostics.filter((d) => d.message.includes("Requirement count mismatch"));
    const oblErrors = diagnostics.filter((d) => d.message.includes("Obligation count mismatch"));
    assert.equal(reqErrors.length, 2, `expected 2 requirement count errors, got ${reqErrors.length}`);
    assert.equal(oblErrors.length, 3, `expected 3 obligation count errors, got ${oblErrors.length}`);
  });

  it("supports weave-in outputs from terminal contract calls in if branches", () => {
    const spec = {
      requirements: [],
      obligations: [{ type: "integer" }]
    };
    const text = `
if true then
  sub /data/new/integer/default/x64()
else
  sub /data/new/integer/default/x64()
end -> out
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/data/new/integer/default/x64": spec as any }
    });
    const obligationErrors = diagnostics.filter((d) => d.message.includes("Obligation count mismatch"));
    const branchErrors = diagnostics.filter((d) => d.message.includes("If branch output count mismatch"));
    assert.equal(obligationErrors.length, 0, `expected no obligation mismatches, got ${obligationErrors.map((d) => d.message).join(", ")}`);
    assert.equal(branchErrors.length, 0, `expected no branch output mismatch, got ${branchErrors.map((d) => d.message).join(", ")}`);
  });

  it("supports nested weave-in with terminal expressions when arity/types match", () => {
    const text = `
if true then
  if false then
    1
  else
    2
  end -> inner_out
else
  3
end -> final_out
`;
    const { program } = parseText(text);
    const { diagnostics, types } = typeCheckProgram(program, { collectTypes: true });
    const branchErrors = diagnostics.filter((d) => d.message.includes("If branch output count mismatch"));
    assert.equal(branchErrors.length, 0, `expected no branch output mismatch, got ${branchErrors.map((d) => d.message).join(", ")}`);

    const finalStmt = (program as any).statements[0];
    const finalTarget = finalStmt.targets?.find((t: any) => t.lexeme === "final_out");
    assert.ok(finalTarget, "expected final_out target");
    const finalTypeEntry = types?.find(
      (t) =>
        t.range.start.line === finalTarget.range.start.line &&
        t.range.start.character === finalTarget.range.start.character &&
        t.range.end.line === finalTarget.range.end.line &&
        t.range.end.character === finalTarget.range.end.character
    );
    assert.equal(finalTypeEntry?.types?.[0]?.kind, TypeKind.Integer, "expected final_out to be INTEGER");
  });

  it("suppresses unknown flow diagnostic when later inferred in same block via '$'", () => {
    const text = `
def test(flow):
  flow -> {
    sub /data/write/constant/default/linux-x64($, "ok")
  }
end
`;
    const spec = {
      requirements: [{ type: "/system/log-manager/default/x64" }, { type: "string" }],
      obligations: []
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/data/write/constant/default/linux-x64": spec as any }
    });
    const unknownFlow = diagnostics.filter((d) => d.message === "Type of 'flow' is unknown");
    assert.equal(unknownFlow.length, 0, `expected no unknown flow diagnostic, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("does not force def flow parameter to SCOPE when block only provides generic '$'", () => {
    const text = `
def dbgConst(flow, msg):
  flow -> {
    sub unknown/contract($, msg)
  }
end

job /data/example/default/x64(flow):
  dbgConst(flow, "x")
end
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program);
    const scopeMismatch = diagnostics.find((d) => d.message.includes("Type mismatch: expected SCOPE"));
    assert.ok(!scopeMismatch, `did not expect SCOPE mismatch, got ${scopeMismatch?.message ?? diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("infers scalar types for assignment targets from arithmetic/concat/logical expressions", () => {
    const text = `
2 * (a + b) -> resultInt
"dog" + cat_label -> ANIMALS_STR
true && logic_label -> ANSWER_BOOL
`;
    const { program } = parseText(text);
    const { types } = typeCheckProgram(program, { collectTypes: true });

    function typeOf(name: string) {
      for (const stmt of (program as any).statements) {
        const tok = stmt.targets?.find((t: any) => t.lexeme === name);
        if (!tok) continue;
        const match = types?.find(
          (t) =>
            t.range.start.line === tok.range.start.line &&
            t.range.start.character === tok.range.start.character &&
            t.range.end.line === tok.range.end.line &&
            t.range.end.character === tok.range.end.character
        );
        if (match) return match.types[0];
      }
      return null;
    }

    assert.equal((typeOf("resultInt") as any)?.kind, TypeKind.Integer, "expected integer target type");
    assert.equal((typeOf("ANIMALS_STR") as any)?.kind, TypeKind.String, "expected string target type");
    assert.equal((typeOf("ANSWER_BOOL") as any)?.kind, TypeKind.Boolean, "expected boolean target type");
  });

  it("infers operand identifier types from integer arithmetic", () => {
    const text = `
2 * (a + b) -> result
`;
    const { program } = parseText(text);
    const { types, diagnostics } = typeCheckProgram(program, { collectTypes: true });
    const unknownDiag = diagnostics.find((d) => d.message.includes("Type of 'a' is unknown") || d.message.includes("Type of 'b' is unknown"));
    assert.ok(!unknownDiag, `expected operand inference, got ${unknownDiag?.message ?? "unknown diagnostic"}`);

    function typeOf(name: string) {
      for (const stmt of (program as any).statements) {
        const tok = stmt.targets?.find((t: any) => t.lexeme === name);
        if (!tok) continue;
        const match = types?.find(
          (t) =>
            t.range.start.line === tok.range.start.line &&
            t.range.start.character === tok.range.start.character &&
            t.range.end.line === tok.range.end.line &&
            t.range.end.character === tok.range.end.character
        );
        if (match) return match.types[0];
      }
      return null;
    }

    assert.equal((typeOf("result") as any)?.kind, TypeKind.Integer, "expected INTEGER result");
    const idTypes = (types ?? []).filter((t) => t.types[0]?.kind === TypeKind.Integer);
    assert.ok(
      idTypes.length >= 3,
      "expected identifiers inside expression to be typed as INTEGER (a, b, result)"
    );
  });

  it("applies job requirement types to parameters", () => {
    const text = `
job /data/compare/integer/default/x64(a, b, c) -> result:
  a + b -> result
end
`;
    const spec = {
      requirements: [
        { name: "a", type: "integer" },
        { name: "b", type: "integer" },
        { name: "c", type: "integer" }
      ],
      obligations: [{ type: "integer" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { collectTypes: true, specs: { "/data/compare/integer/default/x64": spec as any }, defaults });
    const unknowns = diagnostics.filter((d) => d.message.includes("Type of 'a' is unknown") || d.message.includes("Type of 'b' is unknown"));
    assert.equal(unknowns.length, 0, `job params should receive types from spec requirements`);
  });

  it("applies job obligation types to targets when spec is present", () => {
    const text = `
job /data/compare/integer/default/x64(a, b, c) -> result:
  a + b -> result
end
`;
    const spec = {
      requirements: [
        { name: "a", type: "integer" },
        { name: "b", type: "integer" },
        { name: "c", type: "integer" }
      ],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { collectTypes: true, specs: { "/data/compare/integer/default/x64": spec as any }, defaults });
    const unknown = diagnostics.find((d) => d.message.includes("Type of 'result' is unknown"));
    assert.ok(!unknown, `expected job target to be typed from obligations, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("emits job obligation count mismatch and suppresses misleading per-target type mismatch when misaligned", () => {
    const text = `
job /system/fetch/electrum-cash-api/blockchain-address-listunspent/x64(fetch_api, logman, cfgman, task_sched, timerman,
      tcp_client_mgr, fetch_token_in, fetch_cashaddr, SYSTEM_LABEL, SYSTEM_PRIORITY)
  utxo__outp_index, utxo__outp_value, fetch_failure, api__fetch_error_code:
  1 -> api__fetch_error_code
end
`;
    const spec = {
      requirements: [
        { type: "/data/flow/default/x64" },
        { type: "/system/log-manager/default/x64" },
        { type: "/system/configuration-manager/default/x64" },
        { type: "/system/task-scheduler/default/x64" },
        { type: "/system/timer-manager/default/x64" },
        { type: "/system/tcp-client-manager/default/x64" },
        { type: "/data/integer/default/x64" },
        { type: "/data/bytesequence/default/x64" },
        { type: "string" },
        { type: "integer" },
      ],
      obligations: [
        { type: "/data/integer/default/x64" },
        { type: "/data/flow/default/x64" },
        { type: "/data/linkedlist/default/x64" },
        { type: "/data/bytes/default/x64" },
        { type: "/data/integer/default/x64" },
        { type: "/data/unsigned-integer/default/x64" },
        { type: "/data/flow/default/x64" },
        { type: "/data/integer/default/x64" },
      ],
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/system/fetch/electrum-cash-api/blockchain-address-listunspent/x64": spec as any },
      defaults: { layer: "data", variation: "default", platform: "x64" },
    });
    const countMismatch = diagnostics.find((d) => d.message.includes("Obligation count mismatch: expected 8, got 4"));
    const bytesMismatch = diagnostics.find((d) =>
      d.message.includes("expected CLASSIFICATION(/data/bytes/default/x64), got CLASSIFICATION(/data/integer/default/x64)")
    );
    assert.ok(countMismatch, `expected job obligation count mismatch, got ${diagnostics.map((d) => d.message).join(", ")}`);
    assert.ok(!bytesMismatch, `did not expect misleading bytes mismatch, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("makes job target obligation types available to prechecked defs", () => {
    const text = `
job /sys/example/default/x64(flow) -> api__fetch_error_code:
  def logErr(flow):
    flow -> {
      sub /system/log/integer/default/x64($, api__fetch_error_code)
    }
  end
end
`;
    const spec = {
      requirements: [{ type: "/data/flow/default/x64" }],
      obligations: [{ type: "/data/integer/default/x64" }],
    };
    const logIntSpec = {
      requirements: [
        { type: "/system/log-manager/default/x64" },
        { type: "/data/integer/default/x64" }
      ],
      obligations: []
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: {
        "/sys/example/default/x64": spec as any,
        "/system/log/integer/default/x64": logIntSpec as any,
      },
      defaults: { layer: "data", variation: "default", platform: "x64" },
    });
    const unknown = diagnostics.find((d) => d.message.includes("Type of 'api__fetch_error_code' is unknown"));
    assert.ok(!unknown, `did not expect unknown target type in prechecked def, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("emits requirement type mismatch when argument remains UNKNOWN", () => {
    const text = `
sub /data/compare/integer(compare, int1, int2) -> out1
`;
    const spec = {
      requirements: [
        { name: "compare", type: "/data/flow/default/x64" },
        { name: "int1", type: "integer" },
        { name: "int2", type: "integer" }
      ],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/data/compare/integer/default/x64": spec as any },
      defaults
    });
    const mismatches = diagnostics.filter((d) => d.message.includes("Type mismatch: expected"));
    assert.equal(mismatches.length, 0, "requirement types should now be inferred into identifiers");
  });

  it("types builtin asset function returning SITE", () => {
    const text = `
"test.elf" -> fn
asset(fn) -> MY_SITE
`;
    const { program } = parseText(text);
    const { types, diagnostics } = typeCheckProgram(program, { collectTypes: true });
    assert.equal(diagnostics.length, 0, `expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);

    function typeOf(name: string) {
      for (const stmt of (program as any).statements) {
        const tok = stmt.targets?.find((t: any) => t.lexeme === name);
        if (!tok) continue;
        const match = types?.find(
          (t) =>
            t.range.start.line === tok.range.start.line &&
            t.range.start.character === tok.range.start.character &&
            t.range.end.line === tok.range.end.line &&
            t.range.end.character === tok.range.end.character
        );
        if (match) return match.types[0];
      }
      return null;
    }

    assert.equal((typeOf("MY_SITE") as any)?.kind, TypeKind.Site, "expected SITE target type");
  });

  it("infers identifier type from builtin argument expectation", () => {
    const text = `
int2str(b) -> cat
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { collectTypes: true });
    const unknownDiag = diagnostics.find((d) => d.message.includes("Type of 'b' is unknown"));
    assert.ok(!unknownDiag, "expected builtin arg to infer identifier type");
  });

  it("propagates requirement types into call arguments", () => {
    const text = `
"seed" -> check
sub /data/check/condition(check) -> cond, yes, no
`;
    const spec = {
      requirements: [{ name: "check", type: "string" }],
      obligations: [{ type: "/data/flow/default/x64" }, { type: "/data/flow/default/x64" }, { type: "/data/flow/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { types, diagnostics } = typeCheckProgram(program, { collectTypes: true, specs: { "/data/check/condition/default/x64": spec as any }, defaults });
    assert.equal(diagnostics.length, 0, `expected no diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);

    function typeOf(name: string) {
      for (const stmt of (program as any).statements) {
        const tok = stmt.expression?.args?.[0]?.token ?? stmt.targets?.find((t: any) => t.lexeme === name);
        if (!tok) continue;
        const match = types?.find(
          (t) =>
            t.range.start.line === tok.range.start.line &&
            t.range.start.character === tok.range.start.character &&
            t.range.end.line === tok.range.end.line &&
            t.range.end.character === tok.range.end.character
        );
        if (match) return match.types[0];
      }
      return null;
    }

    assert.equal((typeOf("check") as any)?.kind, TypeKind.String, "expected STRING requirement type to flow to argument");
  });

  it("applies contract requirement classification type to scope argument '$'", () => {
    const text = `
sub /data/check/condition/default/x64($) -> cond
`;
    const spec = {
      requirements: [{ name: "flow", type: "/data/flow/default/x64" }],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/data/check/condition/default/x64": spec as any },
      defaults
    });
    const flowMismatch = diagnostics.find((d) =>
      d.message.includes("Type mismatch: expected CLASSIFICATION(/data/flow/default/x64), got UNKNOWN") ||
      d.message.includes("Type mismatch: expected CLASSIFICATION(/data/flow/default/x64), got SCOPE")
    );
    assert.ok(!flowMismatch, `expected '$' to satisfy flow requirement, got ${flowMismatch?.message ?? "no mismatch"}`);
  });

  it("reports mismatch when '$' flow type conflicts with contract requirement classification", () => {
    const text = `
sub /data/new/flow/default/x64() -> {
  sub /data/check/condition/default/x64($) -> cond
}
`;
    const flowSpec = {
      requirements: [],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const conditionSpec = {
      requirements: [{ name: "flow", type: "/system/log-manager/default/x64" }],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: {
        "/data/new/flow/default/x64": flowSpec as any,
        "/data/check/condition/default/x64": conditionSpec as any
      },
      defaults
    });
    assert.ok(
      diagnostics.some((d) =>
        d.message.includes("Type mismatch: expected CLASSIFICATION(/system/log-manager/default/x64), got CLASSIFICATION(/data/flow/default/x64)")
      ),
      `expected mismatch for conflicting '$' classification, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("keeps outer '$'/identifier ancestry when nested blocks retarget '$' classifications", () => {
    const text = `
def test(flow):
  flow -> {
    sub /system/write/log-item/default/x64($, /system/log-manager/default/x64, 1) -> {
      sub /system/log/constant/default/x64($, "x")
    }
  }
  sub /data/check/condition/default/x64(flow) -> ok
end
`;
    const specs = {
      "/system/write/log-item/default/x64": {
        requirements: [
          { name: "write log", type: "/data/flow/default/x64" },
          { name: "log manager", type: "/system/log-manager/default/x64" },
          { name: "criticality level", type: "integer" }
        ],
        obligations: [{ type: "/system/log-manager/default/x64" }]
      },
      "/system/log/constant/default/x64": {
        requirements: [
          { name: "log-item", type: "/system/log-manager/default/x64" },
          { name: "log string", type: "string" }
        ],
        obligations: []
      },
      "/data/check/condition/default/x64": {
        requirements: [{ name: "flow", type: "/data/flow/default/x64" }],
        obligations: [{ type: "/data/flow/default/x64" }]
      }
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { specs: specs as any });
    const leakedMismatch = diagnostics.find((d) =>
      d.message.includes("Type mismatch: expected CLASSIFICATION(/data/flow/default/x64), got CLASSIFICATION(/system/log-manager/default/x64)")
    );
    assert.ok(!leakedMismatch, `expected no leaked '$' classification, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("emits diagnostics for identifiers whose type remains unknown", () => {
    const text = `
def foo(a, b) -> sum
  a + b -> sum
end
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program);
    const unknownTypeDiags = diagnostics.filter(
      (d) => d.message.includes("Type of 'a' is unknown") || d.message.includes("Type of 'b' is unknown")
    );
    assert.ok(unknownTypeDiags.length >= 1, `expected unknown type diagnostics, got ${unknownTypeDiags.length}`);
  });

  it("normalizes protocol classifications with defaults/placeholders", () => {
    const text = `
host /data/integer(_integer, minimum_value, maximum_value) -> int1
host /data/integer/default(_integer, minimum_value, maximum_value) -> int3
host /data/integer/.(_integer, minimum_value, maximum_value) -> int4
host integer(_integer, minimum_value, maximum_value) -> int6
join /data/integer(_self_) -> min1, max1, _integer1
join /data/integer/default(_self_) -> min3, max3, _integer3
`;
    const spec = {
      requirements: [
        { name: "_integer", type: "/data/flow/default/x64" },
        { name: "minimum_value", type: "integer" },
        { name: "maximum_value", type: "integer" }
      ],
      obligations: [{ type: "/data/integer/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: { "/data/integer/default/x64": spec as any },
      defaults
    });
    const unknowns = diagnostics.filter((d) => d.message.includes("Unknown protocol specification"));
    assert.equal(unknowns.length, 0, `expected protocol specs to resolve after normalization, got ${unknowns.map((d) => d.message).join(", ")}`);
  });

  it("normalizes contract classifications with defaults/placeholders", () => {
    const text = `
sub /data/compare/integer(compare, int1, int2) -> out1
sub compare/integer(compare, int1, int2) -> out2
sub /data/compare/integer/.(compare, int1, int2) -> out3
sub write/log-item(compare, int1, int2) -> out4
`;
    const compareSpec = {
      requirements: [
        { name: "compare", type: "/data/flow/default/x64" },
        { name: "int1", type: "integer" },
        { name: "int2", type: "integer" }
      ],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const writeSpec = {
      requirements: [
        { name: "compare", type: "/data/flow/default/x64" },
        { name: "int1", type: "integer" },
        { name: "int2", type: "integer" }
      ],
      obligations: [{ type: "/data/flow/default/x64" }]
    };
    const defaults = { layer: "data", variation: "default", platform: "x64" };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, {
      specs: {
        "/data/compare/integer/default/x64": compareSpec as any,
        "/data/write/log-item/default/x64": writeSpec as any
      },
      defaults
    });
    const unknowns = diagnostics.filter((d) => d.message.includes("Unknown contract specification"));
    assert.equal(unknowns.length, 0, `expected contract specs to resolve after normalization, got ${unknowns.map((d) => d.message).join(", ")}`);
  });

  it("resolves forward def calls when typing block obligations", () => {
    const text = `
job /data/example/default/x64(flow):
  sub /data/new/flow/default/x64() -> {
    logMacro($) -> {
      sub /system/log/constant/default/x64($, "x")
    }
  }
  
  def logMacro(flow) out:
    sub /mock/emit-logmanager/default/x64(flow) -> {
      $ -> out
    }
  end
end
`;
    const specs = {
      "/data/example/default/x64": {
        requirements: [{ name: "flow", type: "/data/flow/default/x64" }],
        obligations: []
      },
      "/data/new/flow/default/x64": {
        requirements: [],
        obligations: [{ type: "/data/flow/default/x64" }]
      },
      "/mock/emit-logmanager/default/x64": {
        requirements: [{ name: "flow", type: "/data/flow/default/x64" }],
        obligations: [{ type: "/system/log-manager/default/x64" }]
      },
      "/system/log/constant/default/x64": {
        requirements: [
          { name: "log-item", type: "/system/log-manager/default/x64" },
          { name: "log string", type: "string" }
        ],
        obligations: []
      }
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { specs: specs as any });
    const leakedMismatch = diagnostics.find((d) =>
      d.message.includes("Type mismatch: expected CLASSIFICATION(/system/log-manager/default/x64), got CLASSIFICATION(/data/flow/default/x64)")
    );
    assert.ok(!leakedMismatch, `expected forward def call to type block '$' correctly, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("treats 'identifier -> { ... }' as declarative endpoint with flow-typed '$'", () => {
    const text = `
sub /sys/source/default/x64() -> timer_expired_cb
timer_expired_cb -> {
  sub /sys/consume/default/x64($)
}
`;
    const specs = {
      "/sys/source/default/x64": {
        requirements: [],
        obligations: [{ type: "/data/flow/default/x64" }]
      },
      "/sys/consume/default/x64": {
        requirements: [{ type: "/data/flow/default/x64" }],
        obligations: []
      }
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { specs: specs as any });
    const mismatch = diagnostics.find((d) => d.message.includes("Type mismatch"));
    const unknown = diagnostics.find((d) => d.message.includes("Type of 'timer_expired_cb' is unknown"));
    assert.ok(!mismatch, `did not expect flow mismatch, got ${mismatch?.message ?? diagnostics.map((d) => d.message).join(", ")}`);
    assert.ok(!unknown, `did not expect unknown endpoint type, got ${unknown?.message ?? diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("reuses existing identifier type for 'identifier -> { ... }' blocks", () => {
    const text = `
job /sys/job/default/x64(fetch_api):
  fetch_api -> {
    sub /sys/consume/default/x64($)
  }
end
`;
    const specs = {
      "/sys/job/default/x64": {
        requirements: [{ type: "/data/flow/default/x64" }],
        obligations: []
      },
      "/sys/consume/default/x64": {
        requirements: [{ type: "/data/flow/default/x64" }],
        obligations: []
      }
    };
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program, { specs: specs as any });
    const duplicate = diagnostics.find((d) => d.message.includes("Duplicate declaration of 'fetch_api'"));
    const mismatch = diagnostics.find((d) => d.message.includes("Type mismatch"));
    assert.ok(!duplicate, `did not expect duplicate declaration, got ${diagnostics.map((d) => d.message).join(", ")}`);
    assert.ok(!mismatch, `did not expect flow mismatch, got ${mismatch?.message ?? diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("leaks declarations from earlier obligation blocks to later statements", () => {
    const text = `
true -> _, {
  1 -> api__token_in
}, {
  2 -> ignored
}
api__token_in -> out
`;
    const { program } = parseText(text);
    const { diagnostics } = typeCheckProgram(program);
    const unknown = diagnostics.find((d) => d.message.includes("Type of 'api__token_in' is unknown"));
    assert.ok(!unknown, `did not expect unknown api__token_in, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });
});
