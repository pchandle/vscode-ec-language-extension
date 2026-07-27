export type GraphLanePresentation<T> = {
  visibleEntries: T[];
  canToggle: boolean;
};

/** Select the compact and expanded topic rows for a graph lane. */
export function presentGraphLane<T extends { id: string }>(
  entries: readonly T[],
  boundTopicIds: ReadonlySet<string>,
  expanded: boolean
): GraphLanePresentation<T> {
  const defaultEntries = entries.filter((entry) => boundTopicIds.has(entry.id));
  return {
    visibleEntries: expanded ? [...entries] : defaultEntries,
    canToggle: defaultEntries.length < entries.length,
  };
}
