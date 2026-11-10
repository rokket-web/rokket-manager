/** Progress over what the client can see: shared tasks and milestones only. null when nothing is shared yet. */
export function sharedProgress(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((done / total) * 100);
}
