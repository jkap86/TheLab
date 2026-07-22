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
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}
