import { strict as assert } from "assert";
import { parseText } from "../lang/parser";
import { resolveProgram } from "../lang/resolver";

describe("resolver", () => {
  it("resolves simple sample without diagnostics", () => {
    const sample = "def foo(a) out:\n  a -> out\nend\nfoo(1) -> result";
    const { program, diagnostics: syntaxDiagnostics } = parseText(sample);
    const { diagnostics: resolverDiagnostics } = resolveProgram(program);
    assert.equal(
      syntaxDiagnostics.length + resolverDiagnostics.length,
      0,
      `Expected no diagnostics, got syntax: ${syntaxDiagnostics
        .map((d) => d.message)
        .join(", ")}; resolver: ${resolverDiagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("reports duplicate declarations in the same scope", () => {
    const text = "job /example/test(x):\n  1 -> a\n  2 -> a\nend";
    const { program } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.ok(diagnostics.some((d) => d.message.toLowerCase().includes("duplicate")), "expected duplicate diagnostic");
  });

  it("allows shadowing in child scopes", () => {
    const text = "job /example/test(x):\n  if true then\n    1 -> x\n  else\n    2 -> y\n  end\n  x -> ok\nend";
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    assert.equal(diagnostics.length, 0, `expected no resolver diagnostics, got ${diagnostics.map((d) => d.message).join(", ")}`);
  });

  it("reports undefined identifiers", () => {
    const text = "job /example/test():\n  foo(bar) -> out\nend";
    const { program } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.ok(diagnostics.some((d) => d.message.includes("Undefined name 'bar'")), "expected undefined name diagnostic for bar");
  });

  it("treats 'identifier -> { ... }' as a declarative endpoint label", () => {
    const text = `
job /example/test():
  sub /system/start/timer-manager($, 0, 0, 0) -> _, _, _, timer_expired_cb
  timer_expired_cb -> {
    1 -> done
  }
end
`;
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    assert.ok(
      !diagnostics.some((d) => d.message.includes("Undefined name 'timer_expired_cb'")),
      `did not expect undefined endpoint diagnostic, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("does not redeclare an existing binding for 'identifier -> { ... }'", () => {
    const text = `
job /example/test(fetch_api):
  fetch_api -> {
    1 -> done
  }
end
`;
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    assert.ok(
      !diagnostics.some((d) => d.message.includes("Duplicate declaration of 'fetch_api'")),
      `did not expect duplicate declaration, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("resolves declarations from earlier obligation blocks in the same statement", () => {
    const text = `
job /example/test():
  sub /example/multi() -> _, {
    1 -> api__token_in
  }, {
    2 -> ignored
  }
  api__token_in -> out
end
`;
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    assert.ok(
      !diagnostics.some((d) => d.message.includes("Undefined name 'api__token_in'")),
      `did not expect undefined api__token_in, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
  });

  it("does not predeclare endpoint labels ahead of leaking nested-block declarations", () => {
    const text = `
job /example/test():
  fetch_api -> {
    sub /example/decode() -> api_sequence, api_data_valid, api_data_invalid
  }
  api_sequence -> {
    1 -> x
  }
  api_data_valid -> {
    1 -> y
  }
  api_data_invalid -> {
    1 -> z
  }
end
`;
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    const duplicates = diagnostics.filter((d) => d.message.includes("Duplicate declaration"));
    assert.equal(duplicates.length, 0, `did not expect duplicate declarations, got ${duplicates.map((d) => d.message).join(", ")}`);
  });

  it("does not flag duplicate when endpoint label is later declared by nested obligation target", () => {
    const text = `
job /behaviour/add/command-line-menu/default/linux-x64(core, menu, descr, help) appflow_out:
  init -> {
    return_to_menu_proc_body -> {
      sub call/procedure($, refresh_menu)
      sub set/integer($, return_to_menu_result, 0)
    }
    sub /system/new/app-flow/./linux-x64(log_man, cfg_man, task_shed, "appflow", 0) -> {
      $ -> new_appflow
      $ -> appflow_out
      sub /system/register/app-flow($, 0) -> _, _, return_to_menu_result, _, _, return_to_menu_proc_body
    }
  }
end
`;
    const { program, diagnostics: syntaxDiagnostics } = parseText(text);
    const { diagnostics } = resolveProgram(program);
    assert.equal(syntaxDiagnostics.length, 0, "unexpected syntax diagnostics");
    assert.ok(
      !diagnostics.some((d) => d.message.includes("Duplicate declaration of 'return_to_menu_proc_body'")),
      `did not expect duplicate return_to_menu_proc_body, got ${diagnostics.map((d) => d.message).join(", ")}`
    );
  });
});
