/**
 * The phase timings `/api/trades` reports, and the tallies beside them.
 *
 * A file of its own because the route is the composition and this is the
 * bookkeeping — the same split `resolveManagerRequest` makes one directory over.
 * It is pure and holds no `NextResponse` and no database, so what is left in the
 * route is the streaming.
 *
 * **What it measures is phases, not calls.** The four lookups a chunk needs run
 * in one `Promise.all`, so timing each of them separately would report four
 * numbers that all read as "however long the slowest one took". `phase` measures
 * elapsed wall time around a piece of work and *accumulates* it under a name
 * across the whole request, which is the shape that answers the question worth
 * asking: over a whole season, how much of this request was spent pricing
 * players against reading trades against writing bytes.
 *
 * The one-shot marks (`mark`) are the opposite and are the latency half: they
 * record when something first happened, so `first-row` and `first-chunk` say how
 * long the page waited rather than how long the work took. A mark is written
 * once and later marks of the same name are ignored, so `mark("first-row")` can
 * sit inside the loop.
 */
export type TradesTiming = ReturnType<typeof startTradesTiming>;

export function startTradesTiming(season: string) {
  const started = performance.now();
  const since = () => performance.now() - started;

  const phases = new Map<string, { ms: number; calls: number }>();
  const marks = new Map<string, number>();
  const counts = new Map<string, number>();

  return {
    /** Time `work` and add it to the running total for `name`. */
    async phase<T>(name: string, work: () => Promise<T>): Promise<T> {
      const at = performance.now();
      try {
        return await work();
      } finally {
        const prev = phases.get(name);
        const ms = performance.now() - at;
        if (prev) {
          prev.ms += ms;
          prev.calls += 1;
        } else {
          phases.set(name, { ms, calls: 1 });
        }
      }
    },

    /** Record when `name` first happened, in ms since the request opened. */
    mark(name: string) {
      if (!marks.has(name)) marks.set(name, since());
    },

    /** Add to a running tally — trades, unique players, bytes, and so on. */
    count(name: string, by = 1) {
      counts.set(name, (counts.get(name) ?? 0) + by);
    },

    /**
     * One line, on the request's way out.
     *
     * A line rather than a structured object because it is read in a terminal
     * and in a platform's log viewer, neither of which will pretty-print JSON;
     * and one line rather than several so a busy server can't interleave two
     * requests' phases into something that reads as one slow request.
     *
     * `outcome` is what separates a request that answered from one the reader
     * walked out on — the numbers mean different things across that line, and a
     * cancelled request showing a small `trades` count is the system working
     * rather than a season that came up short.
     */
    report(outcome: "complete" | "aborted" | "failed") {
      const ms = (n: number) => `${n.toFixed(0)}ms`;
      const parts = [
        `season=${season}`,
        `outcome=${outcome}`,
        `total=${ms(since())}`,
        ...[...marks].map(([name, at]) => `${name}=${ms(at)}`),
        ...[...phases].map(
          ([name, p]) => `${name}=${ms(p.ms)}${p.calls > 1 ? `/${p.calls}` : ""}`,
        ),
        ...[...counts].map(([name, n]) => `${name}=${n}`),
      ];
      console.log(`[trades] ${parts.join(" ")}`);
    },
  };
}
