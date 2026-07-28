import * as assert from "assert";
import { DocumentUpdateCoordinator } from "../client/src/customEditors/DocumentUpdateCoordinator";
import { nextDraftRevision, shouldApplyHostState } from "../webview-src/customEditorSync";

async function run(): Promise<void> {
  assert.equal(shouldApplyHostState(2, 1), false, "a stale acknowledgement must be ignored");
  assert.equal(shouldApplyHostState(2, 2), true, "the current acknowledgement must be accepted");
  assert.equal(shouldApplyHostState(3), true, "external state must be accepted");
  assert.equal(nextDraftRevision(4), 5, "external state must fence delayed acknowledgements");

  let draft = "first";
  let revision = 1;
  const firstSave = { value: draft, revision };
  draft = "first!";
  revision = nextDraftRevision(revision);
  assert.equal(shouldApplyHostState(revision, firstSave.revision), false);
  assert.equal(draft, "first!", "a stale echo cannot remove the final typed character");
  const nextSave = { value: draft, revision };
  assert.deepEqual(nextSave, { value: "first!", revision: 2 });
  const revisionAfterExternalState = nextDraftRevision(revision);
  assert.equal(shouldApplyHostState(revisionAfterExternalState, nextSave.revision), false);

  const coordinator = new DocumentUpdateCoordinator();
  const sourceUpdates: Array<number | undefined> = [];
  const otherUpdates: Array<number | undefined> = [];
  const source = coordinator.register("file:///design.pdes", (ack) => sourceUpdates.push(ack));
  coordinator.register("file:///design.pdes", (ack) => otherUpdates.push(ack));
  let version = 1;
  const writes: string[] = [];

  await coordinator.enqueue("file:///design.pdes", source.panelId, 1, () => version, async () => {
    writes.push("first");
    version = 2;
    assert.equal(coordinator.handleDocumentChange("file:///design.pdes", version), true);
  });
  await coordinator.enqueue("file:///design.pdes", source.panelId, 2, () => version, async () => {
    writes.push("second");
    version = 3;
    assert.equal(coordinator.handleDocumentChange("file:///design.pdes", version), true);
  });

  assert.deepEqual(writes, ["first", "second"], "writes must be serialized");
  assert.deepEqual(sourceUpdates, [1, 2], "the source panel must receive acknowledgements");
  assert.deepEqual(otherUpdates, [undefined, undefined], "other panels receive external refreshes");

  coordinator.handleDocumentChange("file:///design.pdes", 4);
  coordinator.handleDocumentChange("file:///design.pdes", 4);
  assert.equal(sourceUpdates.at(-1), undefined, "external changes are not acknowledgements");
  assert.equal(otherUpdates.at(-1), undefined, "external changes refresh every panel");
  assert.equal(sourceUpdates.length, 3, "one document event must refresh all panels only once");

  await coordinator.enqueue("file:///design.pdes", source.panelId, 3, () => version, async () => {
    writes.push("no-op");
  });
  assert.equal(sourceUpdates.at(-1), 3, "no-op writes still acknowledge their source");

  source.dispose();
}

void run().then(
  () => console.log("custom editor synchronization tests passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
