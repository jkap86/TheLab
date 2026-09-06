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

/**
 * A gate that lets at most `limit` of the calls through it run at once.
 *
 * **For a fan-out whose branches are different shapes**, which is the one
 * {@link collectWithConcurrency} cannot serve: that maps a homogeneous list, so
 * a request whose parallel reads return seven different types would have to
 * flatten them into a union and cast them back apart. This wraps each call
 * where it is written, so the `Promise.all` above it keeps its tuple types and
 * the call site still reads as the fan-out it is.
 *
 * What it is *for* is the same thing: `Promise.all` over reads that each take a
 * pool connection is a request holding as many connections as it has branches,
 * and at a handful of concurrent readers that is the whole pool. A gate turns
 * "eight at once" into "eight, four at a time" — which costs a round or two of
 * latency on a cold request and bounds what one request can take from every
 * other one.
 *
 * **The bound is per gate, not per process**, so a gate created per request is
 * a per-request bound and one created at module scope is a process-wide one.
 * The first is usually what a route wants: it is protecting the pool from *its
 * own* fan-out, and a shared gate would make two unrelated requests queue
 * behind each other for no reason.
 *
 * Nothing is queued that has not been called: a task starts immediately if
 * there is room, and otherwise waits for a slot in call order. A task that
 * throws releases its slot like any other, so one failure cannot wedge the
 * gate — which matters here because every caller of this in the trades route
 * has a branch that is allowed to fail.
 */
export function concurrencyGate(
  limit: number,
): <R>(fn: () => Promise<R>) => Promise<R> {
  const max = Math.max(1, limit);
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    active -= 1;
    // Shifted rather than popped, so a gate under sustained pressure is
    // first-come-first-served rather than a stack that can starve its oldest
    // waiter indefinitely.
    const next = waiting.shift();
    if (next) next();
  };

  return async <R,>(fn: () => Promise<R>): Promise<R> => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
