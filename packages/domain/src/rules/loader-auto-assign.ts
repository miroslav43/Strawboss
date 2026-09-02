/**
 * Tie-break for auto-assigning an auxiliary truck to a loader: given the
 * loader task_assignment ids whose parcel/depot matches the truck's pickup
 * source for the day, pick one. Only ever called once per truck — the
 * caller only auto-assigns a truck that has no task_assignments row yet for
 * that date, so there is no "reshuffle" concern to design around.
 */
export function pickLoaderMatch(candidateLoaderTaskIds: string[]): string | null {
  if (candidateLoaderTaskIds.length === 0) return null;
  const index = Math.floor(Math.random() * candidateLoaderTaskIds.length);
  return candidateLoaderTaskIds[index] ?? null;
}
