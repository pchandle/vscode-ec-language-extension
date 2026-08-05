import * as assert from "assert";
import { coalesceFileChange, removeFileRecord, replaceFileRecord } from "../componentManagerIndexState";

suite("Component Manager index state", () => {
  test("replaces and removes a record by URI", () => {
    const records = new Map<string, number>();
    replaceFileRecord(records, "file:///component.pdes", 1);
    replaceFileRecord(records, "file:///component.pdes", 2);
    assert.equal(records.get("file:///component.pdes"), 2);
    removeFileRecord(records, "file:///component.pdes");
    assert.equal(records.size, 0);
  });

  test("coalesces a filesystem burst with the last action and retained save intent", () => {
    const changes = new Map();
    coalesceFileChange(changes, "file:///component.pdes", "first", "upsert", true);
    coalesceFileChange(changes, "file:///component.pdes", "second", "delete");
    coalesceFileChange(changes, "file:///component.pdes", "third", "upsert");
    assert.deepEqual(changes.get("file:///component.pdes"), { item: "third", action: "upsert", synchronise: true });
  });
});
