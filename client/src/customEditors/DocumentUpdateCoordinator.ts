export type RefreshPanel = (ackRevision?: number) => void;

type Panel = {
  id: string;
  refresh: RefreshPanel;
};

type DocumentEntry = {
  panels: Map<string, Panel>;
  tail: Promise<void>;
  activeOrigin?: { panelId: string; revision: number };
  selfWriteVersion?: number;
  externalRefreshVersion?: number;
};

/**
 * Serializes full-document custom-editor writes and identifies their originating
 * webview. This lets the source receive an acknowledgement while other panels
 * receive a normal external refresh.
 */
export class DocumentUpdateCoordinator {
  private readonly documents = new Map<string, DocumentEntry>();
  private nextPanelId = 0;

  public register(documentKey: string, refresh: RefreshPanel): { panelId: string; dispose: () => void } {
    const entry = this.entryFor(documentKey);
    const panelId = `panel-${++this.nextPanelId}`;
    entry.panels.set(panelId, { id: panelId, refresh });

    return {
      panelId,
      dispose: () => {
        const current = this.documents.get(documentKey);
        if (!current) {
          return;
        }
        current.panels.delete(panelId);
        if (current.panels.size === 0 && !current.activeOrigin) {
          this.documents.delete(documentKey);
        }
      },
    };
  }

  public enqueue(
    documentKey: string,
    panelId: string,
    revision: number,
    getDocumentVersion: () => number,
    write: () => Promise<void>
  ): Promise<void> {
    const entry = this.entryFor(documentKey);
    const run = async () => {
      entry.activeOrigin = { panelId, revision };
      try {
        await write();
      } finally {
        entry.selfWriteVersion = getDocumentVersion();
        entry.activeOrigin = undefined;
        this.refresh(documentKey, panelId, revision);
      }
    };

    const result = entry.tail.catch(() => undefined).then(run);
    entry.tail = result.catch(() => undefined);
    return result;
  }

  /** Returns true when this change belongs to a queued custom-editor write. */
  public handleDocumentChange(documentKey: string, documentVersion: number): boolean {
    const entry = this.documents.get(documentKey);
    if (!entry) {
      return false;
    }
    if (entry.activeOrigin) {
      entry.selfWriteVersion = documentVersion;
      return true;
    }
    if (entry.selfWriteVersion === documentVersion) {
      return true;
    }
    if (entry.externalRefreshVersion === documentVersion) {
      return false;
    }
    entry.externalRefreshVersion = documentVersion;
    this.refresh(documentKey);
    return false;
  }

  private entryFor(documentKey: string): DocumentEntry {
    let entry = this.documents.get(documentKey);
    if (!entry) {
      entry = { panels: new Map(), tail: Promise.resolve() };
      this.documents.set(documentKey, entry);
    }
    return entry;
  }

  private refresh(documentKey: string, sourcePanelId?: string, ackRevision?: number): void {
    const entry = this.documents.get(documentKey);
    if (!entry) {
      return;
    }
    for (const panel of entry.panels.values()) {
      panel.refresh(panel.id === sourcePanelId ? ackRevision : undefined);
    }
  }
}
