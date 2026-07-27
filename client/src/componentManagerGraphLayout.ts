export type ProtocolMapLayoutItem = { id: string; side: "host" | "join"; height?: number };
export type ProtocolMapPosition = { x: number; y: number };
export type ProtocolMapLayout = {
  positions: Map<string, ProtocolMapPosition>;
  anchor: ProtocolMapPosition;
  bounds: { width: number; height: number };
};

const CARD_WIDTH = 280;
const COLUMN_GAP = 26;
const ROW_STEP = 160;
const ROW_GAP = 26;
const FALLBACK_CARD_HEIGHT = ROW_STEP - ROW_GAP;
const REGION_GAP = 125;

function columnsFor(count: number): number {
  if (count >= 7) return 3;
  if (count >= 2) return 2;
  return 1;
}

function gridWidth(count: number): number {
  if (count === 0) return 0;
  const columns = columnsFor(count);
  return columns * CARD_WIDTH + (columns - 1) * COLUMN_GAP;
}

function heightFor(item: ProtocolMapLayoutItem): number {
  return typeof item.height === "number" && Number.isFinite(item.height) && item.height > 0
    ? item.height
    : FALLBACK_CARD_HEIGHT;
}

function placeRegion(entries: ProtocolMapLayoutItem[], columns: number, startX: number, positions: Map<string, ProtocolMapPosition>): number {
  if (entries.length === 0) return 0;

  const rows = Math.ceil(entries.length / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);
  entries.forEach((item, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row], heightFor(item));
  });

  const rowOffsets: number[] = [];
  let y = 0;
  rowHeights.forEach((height) => {
    rowOffsets.push(y);
    y += height + ROW_GAP;
  });

  entries.forEach((item, index) => positions.set(item.id, {
    x: startX + (index % columns) * (CARD_WIDTH + COLUMN_GAP),
    y: rowOffsets[Math.floor(index / columns)],
  }));
  return y;
}

/** Deterministic, compact host/join layout for the protocol map renderer. */
export function layoutProtocolMap(items: ProtocolMapLayoutItem[]): ProtocolMapLayout {
  const hosts = items.filter((item) => item.side === "host");
  const joins = items.filter((item) => item.side === "join");
  const hostColumns = columnsFor(hosts.length);
  const joinColumns = columnsFor(joins.length);
  const hostWidth = gridWidth(hosts.length);
  const joinWidth = gridWidth(joins.length);
  const joinStart = hosts.length ? hostWidth + REGION_GAP : 0;
  const positions = new Map<string, ProtocolMapPosition>();

  const hostHeight = placeRegion(hosts, hostColumns, 0, positions);
  const joinHeight = placeRegion(joins, joinColumns, joinStart, positions);
  const height = Math.max(hostHeight, joinHeight, ROW_STEP);
  const rows = Math.max(Math.ceil(hosts.length / hostColumns), Math.ceil(joins.length / joinColumns), 1);

  return {
    positions,
    // This node is deliberately invisible. It preserves protocol-mediated
    // relationships without duplicating the protocol already named above.
    // Keep its logical row stable as cards grow: centring it against measured
    // content turns the conduit into a moving bus across unrelated cards.
    anchor: { x: hosts.length && joins.length ? hostWidth + REGION_GAP / 2 : Math.max(hostWidth, joinWidth) / 2, y: (rows - 1) * ROW_STEP / 2 },
    bounds: { width: joinStart + joinWidth || hostWidth, height },
  };
}
