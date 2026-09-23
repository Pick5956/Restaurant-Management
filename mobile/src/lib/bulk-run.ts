// Many requests, a few at a time. The table-management selection closes,
// reseats and deletes tables in bulk; the server takes one table per request,
// and firing forty at once would queue them behind each other on a phone's
// connection anyway while leaving no room for the screen's own reloads. A zone
// move runs with a limit of 1, because each move takes the next number in its
// zone and the preview promised them in floor order.

/**
 * Runs `task` over `items` with at most `limit` in flight, and resolves with
 * the results in the order of `items`. `onProgress` fires once per finished
 * item. A limit below 1 (or not a number) runs one at a time.
 *
 * Tasks are expected to settle on their own - the table screen's return an
 * outcome rather than throwing. If one does throw, the rest still finish and
 * the whole run then rejects with that error.
 */
export async function runLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) return results;
  const width = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  let next = 0;
  let done = 0;
  let failure: { error: unknown } | null = null;

  const worker = async () => {
    while (next < total) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        if (!failure) failure = { error };
      }
      done += 1;
      onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(width, total) }, () => worker()));
  if (failure) throw (failure as { error: unknown }).error;
  return results;
}
