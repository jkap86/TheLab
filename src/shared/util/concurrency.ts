/**
 * Run `fn` over `items` with at most `limit` in flight at once. Workers pull from
 * a shared cursor, so a slow item doesn't hold up the rest — the next free worker
 * just picks up the following index. Resolves once every item has been processed.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  await collectWithConcurrency(items, limit, fn);
}

/**
 * The same walk, keeping what each call returned — in the input's order, not
 * completion order, since a caller zipping results back against their items is
 * the whole reason to want them.
 *
 * It exists because `Promise.all(items.map(…))` is the shape that reads as
 * harmless and isn't: over a list whose length is *data* rather than a constant,
 * it is an unbounded fan-out, and where each call takes a pool connection that
 * is one request holding the whole pool. Reach for this wherever the list being
 * mapped grows with the account being looked at.
 */
export async function collectWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}
