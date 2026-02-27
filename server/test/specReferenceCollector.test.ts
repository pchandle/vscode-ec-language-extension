import { strict as assert } from "assert";
import { parseText } from "../src/lang/parser";
import { collectReferencedClassifications } from "../src/specReferenceCollector";

describe("specReferenceCollector", () => {
  it("collects contract classifications nested in if then/else expression blocks", () => {
    const text = `
if true then
  sub /system/stop/timer-manager($, timerman, timer_id)
else
  sub /system/close/tcp-client-manager($, tcp_client_mgr, conn_id, false)
end -> done
`;
    const { program } = parseText(text);
    const refs = collectReferencedClassifications(program as any, {
      layer: "data",
      variation: "default",
      platform: "x64",
    });

    assert.ok(
      refs.classifications.has("/system/stop/timer-manager/default/x64"),
      "expected nested then-branch contract classification to be collected"
    );
    assert.ok(
      refs.classifications.has("/system/close/tcp-client-manager/default/x64"),
      "expected nested else-branch contract classification to be collected"
    );
  });

  it("collects shorthand classifications in obligation blocks and maps raw->normalized", () => {
    const text = `
def logIntegerWithTaskId(flow, LEVEL, PREFIX, INT_NAME, integer) xtra_logging:
  sub check/flag(flow, cfg_enable_debug) -> {
    sub /system/write/log-item($, logman, LEVEL) -> {
      sub /system/log/constant($, PREFIX)
      $ -> xtra_logging
    }
  }, _
end
`;
    const { program } = parseText(text);
    const refs = collectReferencedClassifications(program as any, {
      layer: "data",
      variation: "default",
      platform: "x64",
    });

    assert.equal(
      refs.rawToNormalized.get("check/flag"),
      "/data/check/flag/default/x64",
      "expected shorthand classification to normalize with defaults"
    );
    assert.ok(
      refs.classifications.has("/system/write/log-item/default/x64"),
      "expected braced obligation block classifications to be collected"
    );
  });

  it("classifies host/join statements as protocol lookups", () => {
    const text = `
host /system/log-manager($, logman)
join /data/flow($, stream)
`;
    const { program } = parseText(text);
    const refs = collectReferencedClassifications(program as any, {
      layer: "data",
      variation: "default",
      platform: "x64",
    });

    const hostNorm = "/system/log-manager/default/x64";
    const joinNorm = "/data/flow/default/x64";

    assert.equal(refs.classificationKinds.get(hostNorm), "protocol");
    assert.equal(refs.classificationKinds.get(joinNorm), "protocol");
  });
});
