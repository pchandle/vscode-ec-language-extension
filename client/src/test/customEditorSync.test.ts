import * as assert from "assert";
import { DocumentUpdateCoordinator } from "../customEditors/DocumentUpdateCoordinator";

suite("Custom editor synchronization", () => {
  test("acknowledges the source panel and externally refreshes a second panel", async () => {
    const coordinator = new DocumentUpdateCoordinator();
    const sourceUpdates: Array<number | undefined> = [];
    const secondPanelUpdates: Array<number | undefined> = [];
    const source = coordinator.register("file:///two-pane.pdes", (ack) => sourceUpdates.push(ack));
    coordinator.register("file:///two-pane.pdes", (ack) => secondPanelUpdates.push(ack));
    let version = 1;

    await coordinator.enqueue("file:///two-pane.pdes", source.panelId, 7, () => version, async () => {
      version = 2;
      coordinator.handleDocumentChange("file:///two-pane.pdes", version);
    });

    assert.deepEqual(sourceUpdates, [7]);
    assert.deepEqual(secondPanelUpdates, [undefined]);
  });
});
