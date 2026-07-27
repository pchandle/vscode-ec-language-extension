import * as assert from "assert";
import { presentGraphLane } from "../componentManagerGraphPresentation";

const entries = [{ id: "self" }, { id: "detail" }];

suite("Component Manager graph lane presentation", () => {
  test("shows only bound self topics in the compact lane and reveals all topics when expanded", () => {
    const compact = presentGraphLane(entries, new Set(["self"]), false);
    const expanded = presentGraphLane(entries, new Set(["self"]), true);

    assert.deepEqual(compact.visibleEntries.map((entry) => entry.id), ["self"]);
    assert.equal(compact.canToggle, true);
    assert.deepEqual(expanded.visibleEntries.map((entry) => entry.id), ["self", "detail"]);
  });

  test("does not offer a toggle when every lane topic is already visible", () => {
    const presentation = presentGraphLane([{ id: "self" }], new Set(["self"]), false);
    assert.equal(presentation.canToggle, false);
    assert.deepEqual(presentation.visibleEntries.map((entry) => entry.id), ["self"]);
  });
});
