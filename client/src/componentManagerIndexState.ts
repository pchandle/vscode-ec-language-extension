export type FileChangeAction = "upsert" | "delete";
export type PendingFileChange<T> = { item: T; action: FileChangeAction; synchronise?: boolean };

/** Coalesce a filesystem burst; the latest action wins while save intent is retained. */
export function coalesceFileChange<T>(
  changes: Map<string, PendingFileChange<T>>,
  key: string,
  item: T,
  action: FileChangeAction,
  synchronise = false
): void {
  const previous = changes.get(key);
  changes.set(key, { item, action, synchronise: synchronise || previous?.synchronise === true });
}

export function replaceFileRecord<T>(records: Map<string, T>, key: string, record: T): void {
  records.set(key, record);
}

export function removeFileRecord<T>(records: Map<string, T>, key: string): void {
  records.delete(key);
}
