import { strict as assert } from "assert";
import { analyseComponentManagerExpression } from "../src/componentManagerAnalysis";

describe("Component Manager expression analysis", () => {
  it("projects parsed job headers and direct host/join label bindings", () => {
    const analysis = analyseComponentManagerExpression(
      "defaults: system, default, x64, local\n" +
      "job /system/create/component/default/x64(input) -> output:\n" +
      "  join /system/collaboration/default/x64(input, role_input) -> role_output\n" +
      "  host /system/collaboration/default/x64(host_input) -> output\n" +
      "end\n"
    );
    assert.equal(analysis.jobs.length, 1);
    const [job] = analysis.jobs;
    assert.equal(job.classification, "/system/create/component/default/x64");
    assert.deepEqual(job.requirements.map((label) => label.label), ["input"]);
    assert.deepEqual(job.obligations.map((label) => label.label), ["output"]);
    assert.equal(job.statements.length, 2);
    assert.deepEqual(job.statements[0].requirements.map((label) => label.label), ["input", "role_input"]);
    assert.deepEqual(job.statements[0].obligations.map((label) => label.label), ["role_output"]);
  });

  it("keeps multiple parsed jobs separate", () => {
    const analysis = analyseComponentManagerExpression(
      "job /system/create/one/default/x64():\nend\njob /system/create/two/default/x64():\nend\n"
    );
    assert.equal(analysis.jobs.length, 2);
    assert.notEqual(analysis.jobs[0].range.start.line, analysis.jobs[1].range.start.line);
  });
});
