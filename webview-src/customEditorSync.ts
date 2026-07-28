/** True when an incoming host state is safe to use for the current local draft. */
export function shouldApplyHostState(currentRevision: number, ackRevision?: number): boolean {
  return ackRevision === undefined || ackRevision === currentRevision;
}

/** Advances the local fence after an edit or an accepted external replacement. */
export function nextDraftRevision(currentRevision: number): number {
  return currentRevision + 1;
}
