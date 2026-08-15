/**
 * How long a read took, when somebody is asking.
 *
 * **Off unless `READ_TIMING=on`**, the switch `CACHE_DEBUG` already sets the
 * shape of: these are the hottest routes in the app, so a line per request is a
 * production log nobody can read past. The environment is read *once*, at module
 * load, so the common case is an empty function the engine can inline away
 * rather than a lookup on the hot path.
 *
 * It exists because the League Details split is a claim about *where the time
 * goes*, and that claim needs to stay checkable: the core, the two value
 * columns, the outlook, the week and the timeline are five reads now, and the
 * only way to know which of them has grown is to see them apart. One label per
 * route, so a development run reads as a ledger:
 *
 *     [read] league.core        12ms  league=123
 *     [read] league.values     164ms  league=123
 *     [read] league.outlook     88ms  league=123
 *
 * It times the **handler**, not the request, which is the honest boundary for a
 * route file: serialisation and transfer belong to whatever is measuring from
 * the outside, and a number that quietly included them would flatter or blame
 * this code for something it does not do.
 */

const ENABLED = process.env.READ_TIMING === "on";

/**
 * Run `read`, reporting what it cost under `label`.
 *
 * Reports on a failure too, and says so: a read that took two seconds and then
 * threw is the one most worth seeing, and a timer that only logs the happy path
 * hides exactly that.
 */
export async function withReadTiming<T>(
  label: string,
  subject: string,
  read: () => Promise<T>,
): Promise<T> {
  if (!ENABLED) return read();

  const started = performance.now();
  try {
    return await read();
  } finally {
    const ms = performance.now() - started;
    console.log(`[read] ${label.padEnd(16)} ${ms.toFixed(0)}ms  ${subject}`);
  }
}
