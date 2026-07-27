import * as assert from "assert";
import { layoutProtocolMap } from "../componentManagerGraphLayout";

suite("Component Manager protocol-map layout", () => {
  test("wraps seven join jobs into a compact three-column grid", () => {
    const layout = layoutProtocolMap([{ id: "host", side: "host" }, ...Array.from({ length: 7 }, (_, index) => ({ id: `join-${index}`, side: "join" as const }))]);

    assert.deepEqual(layout.positions.get("join-0"), { x: 405, y: 0 });
    assert.deepEqual(layout.positions.get("join-3"), { x: 405, y: 160 });
    assert.equal(layout.bounds.height, 480);
  });

  test("keeps host and join regions deterministic when only one role is present", () => {
    const hosts = layoutProtocolMap([{ id: "host-0", side: "host" }, { id: "host-1", side: "host" }]);
    const joins = layoutProtocolMap([{ id: "join-0", side: "join" }, { id: "join-1", side: "join" }]);

    assert.deepEqual(hosts.positions.get("host-1"), { x: 306, y: 0 });
    assert.deepEqual(joins.positions.get("join-1"), { x: 306, y: 0 });
    assert.ok(hosts.anchor.x > 0);
    assert.ok(joins.anchor.x > 0);
  });

  test("keeps mixed participation in the host region when supplied by the projection", () => {
    const layout = layoutProtocolMap([{ id: "mixed", side: "host" }, { id: "join", side: "join" }]);
    assert.deepEqual(layout.positions.get("mixed"), { x: 0, y: 0 });
    assert.deepEqual(layout.positions.get("join"), { x: 405, y: 0 });
  });

  test("moves following rows below the tallest measured card in the preceding row", () => {
    const layout = layoutProtocolMap([
      { id: "join-0", side: "join", height: 300 },
      { id: "join-1", side: "join", height: 140 },
      { id: "join-2", side: "join", height: 140 },
    ]);

    assert.deepEqual(layout.positions.get("join-2"), { x: 0, y: 326 });
    assert.equal(layout.bounds.height, 492);
    assert.equal(layout.anchor.y, 80);
  });

  test("lays out host and join rows independently when their card heights differ", () => {
    const layout = layoutProtocolMap([
      { id: "host-0", side: "host", height: 260 },
      { id: "host-1", side: "host", height: 100 },
      { id: "host-2", side: "host", height: 100 },
      { id: "join-0", side: "join", height: 120 },
      { id: "join-1", side: "join", height: 120 },
      { id: "join-2", side: "join", height: 120 },
    ]);

    assert.deepEqual(layout.positions.get("host-2"), { x: 0, y: 286 });
    assert.deepEqual(layout.positions.get("join-2"), { x: 711, y: 146 });
    assert.equal(layout.bounds.height, 412);
  });

  test("uses the former row slot when cards have not yet been measured", () => {
    const layout = layoutProtocolMap([
      { id: "join-0", side: "join" },
      { id: "join-1", side: "join" },
      { id: "join-2", side: "join" },
    ]);

    assert.deepEqual(layout.positions.get("join-2"), { x: 0, y: 160 });
    assert.equal(layout.bounds.height, 320);
  });
});
