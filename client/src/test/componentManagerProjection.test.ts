import * as assert from "assert";
import { projectComponentGraph, ProjectionJobInput, SourceRef } from "../componentManagerProjection";

const source = (line = 0): SourceRef => ({ uri: "file:///components/example.dla", range: { start: { line, character: 0 }, end: { line, character: 8 } } });
const topic = (id: string, expressionLabel: string, displayName: string, line: number) => ({ id, expressionLabel, displayName, source: source(line), jobHeaderSource: source(line) });

function job(id: string, statements: ProjectionJobInput["statements"]): ProjectionJobInput {
  return {
    id,
    classification: `/system/create/${id}/default/x64`,
    source: source(),
    requirements: [topic(`${id}:req:input`, "input", "Contract input", 1), topic(`${id}:req:unrelated`, "unrelated", "Contract detail", 2)],
    obligations: [topic(`${id}:ob:output`, "output", "Contract output", 3)],
    statements,
  };
}

const host = (requirements: string[], obligations: string[] = []) => ({
  role: "host" as const,
  classification: "/system/protocol/default/x64",
  requirements: requirements.map((label, index) => ({ label, source: source(10 + index) })),
  obligations: obligations.map((label, index) => ({ label, source: source(20 + index) })),
});
const join = (requirements: string[], obligations: string[] = []) => ({
  role: "join" as const,
  classification: "/system/protocol/default/x64",
  requirements: requirements.map((label, index) => ({ label, source: source(30 + index) })),
  obligations: obligations.map((label, index) => ({ label, source: source(40 + index) })),
});

const selectedProtocol = (selfSlots: { host?: number; join?: number } = { host: 0, join: 0 }) => ({
  classification: "/system/protocol/default/x64",
  selfSlots,
});

suite("Component Manager graph projection", () => {
  test("projects only the host-obligation self label and ignores all other host labels", () => {
    const projection = projectComponentGraph(selectedProtocol(), [job("host-job", [host(["input", "missing"], ["output"])])]);
    const bindings = projection.jobs[0].bindings;

    assert.deepEqual(bindings.map((binding) => [binding.role, binding.lane, binding.expressionLabel]), [["host", "obligations", "output"]]);
    assert.ok(bindings.every((binding) => binding.topicId.startsWith("host-job:")));
    assert.equal(projection.jobs[0].obligations[0].displayName, "Contract output");
  });

  test("projects only the join-requirement self label and retains its source", () => {
    const projection = projectComponentGraph(selectedProtocol(), [job("join-job", [join(["input"], ["output"])])]);
    const bindings = projection.jobs[0].bindings;

    assert.deepEqual(bindings.map((binding) => [binding.role, binding.lane, binding.expressionLabel]), [["join", "requirements", "input"]]);
    assert.deepEqual(bindings[0].source, source(30));
    assert.deepEqual(projection.jobs[0].requirements[0].source, source(1));
    assert.deepEqual(projection.jobs[0].requirements[0].jobHeaderSource, source(1));
  });

  test("does not match a self label in the wrong job-header lane or an ambiguous lane", () => {
    const crossLane = projectComponentGraph(selectedProtocol({ host: 0 }), [job("cross-lane", [host([], ["input"])])]);
    const ambiguous: ProjectionJobInput = {
      ...job("ambiguous", [join(["input"])]),
      requirements: [topic("ambiguous:req:0", "input", "First", 1), topic("ambiguous:req:1", "input", "Second", 2)],
    };
    const ambiguousProjection = projectComponentGraph(selectedProtocol({ join: 0 }), [ambiguous]);

    assert.equal(crossLane.counts.directUseJobs, 0);
    assert.equal(ambiguousProjection.counts.directUseJobs, 0);
  });

  test("omits statements with missing or out-of-range self slots", () => {
    const noSelf = projectComponentGraph(selectedProtocol({}), [job("no-self", [join(["input"])])]);
    const outOfRange = projectComponentGraph(selectedProtocol({ join: 2 }), [job("out-of-range", [join(["input"])])]);

    assert.equal(noSelf.counts.directUseJobs, 0);
    assert.equal(outOfRange.counts.directUseJobs, 0);
  });

  test("places host-containing jobs left, join-only jobs right, and mixed jobs once left", () => {
    const projection = projectComponentGraph(selectedProtocol(), [
      job("host-job", [host([], ["output"])]),
      job("join-job", [join(["input"])]),
      job("mixed-job", [host([], ["output"]), join(["input"])]),
    ]);

    assert.deepEqual(projection.jobs.map((item) => item.side), ["host", "join", "host"]);
    assert.deepEqual(projection.counts, { directUseJobs: 3, hostJobs: 2, joinJobs: 1 });
    assert.equal(projection.jobs[2].bindings.length, 2);
    assert.equal(projection.jobs[2].participation, "mixed");
  });

  test("carries a host or join statement diagnostic to its bound contract topic", () => {
    const projection = projectComponentGraph(selectedProtocol({ join: 0 }), [job("join-job", [{
      ...join(["input"]),
      diagnostics: [{ severity: "error", message: "Requirement count mismatch: expected 2, got 1" }],
    }])]);

    assert.deepEqual(projection.jobs[0].bindings[0].diagnostics, [{ severity: "error", message: "Requirement count mismatch: expected 2, got 1" }]);
  });
});
