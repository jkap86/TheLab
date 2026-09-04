import { getKtcBoard, getKtcPickBoard } from "./queries";
import type { KtcPickBoard } from "./queries";
import { KTC_TTL_MS } from "./sync";
import type { KtcFormat } from "./types";
import type { KtcValueSet } from "./values";

/**
 * A market's boards, held in process between reads.
 *
 * The memo in front of `./queries`, on `projections/ros-read`'s exact terms and
 * for the same reason: the lineups route prices every roster in every league a
 * manager plays, and the trades route prices every asset on a page, so both
 * would otherwise read ~900 rows per request to answer with numbers that only
 * change every fifteen minutes.
 *
 * Three properties carried over from that file deliberately:
 *
 * - **The TTL is the sync's own** ({@link KTC_TTL_MS}). A cache outliving the
 *   thing it caches is a second staleness policy, and the two would disagree.
 * - **A failed read is evicted, never cached** — the `memoize-manager-lookup`
 *   rule. A database blip remembered for fifteen minutes is an outage extended
 *   by exactly the mechanism meant to absorb one, and this read has a caller
 *   that degrades gracefully, so the cost of retrying is a query.
 * - **Cached on `globalThis`**, because a per-bundle copy would re-read the
 *   board once per route rather than once per process.
 *
 * A *map* keyed by format rather than `ros-read`'s single slot: an account
 * holding both dynasty and redraft leagues reads both boards on one request, so
 * one slot would be two evictions per page. It is bounded by there being
 * exactly two formats.
 */

/** One format's two boards and when the rows behind them were scraped. */
export type KtcBoards = {
  /** Sleeper player id → both QB numbers; an id KTC doesn't price is absent. */
  values: KtcValueSet["values"];
  /** KTC's rookie-pick rows, keyed by `ktcPickKey`. Empty on the redraft market. */
  picks: KtcPickBoard;
  /**
   * When the rows were scraped, ISO 8601; null when the board is empty. These
   * are someone else's numbers on a fifteen-minute cache, so anything showing
   * them should be able to say how old they are.
   */
  updated_at: string | null;
};

type Entry = { at: number; boards: Promise<KtcBoards> };

const CACHE_KEY = Symbol.for("thelab.ktc.boards");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Map<KtcFormat, Entry>;
};

const cache = (): Map<KtcFormat, Entry> =>
  (globalScope[CACHE_KEY] ??= new Map());

/**
 * One market's boards, from cache where it is fresh.
 *
 * Rejects where the read does — a caller that cannot price is expected to say
 * so and carry on (`ktc: null` on the lineups payload, an em dash on a card),
 * never to fail the page over a valuation.
 */
export function getKtcBoards(format: KtcFormat): Promise<KtcBoards> {
  const entries = cache();
  const cached = entries.get(format);
  if (cached && Date.now() - cached.at < KTC_TTL_MS) return cached.boards;

  const entry: Entry = { at: Date.now(), boards: readBoards(format) };
  entries.set(format, entry);

  entry.boards.catch(() => {
    // Evict only our own entry — a newer read may already be underway.
    if (entries.get(format) === entry) entries.delete(format);
  });

  return entry.boards;
}

async function readBoards(format: KtcFormat): Promise<KtcBoards> {
  // Two independent reads of one table; together, since neither needs the
  // other's answer and the pool would otherwise serialise a pair of index
  // scans for no reason.
  const [values, picks] = await Promise.all([
    getKtcBoard(format),
    getKtcPickBoard(format),
  ]);
  return { values: values.values, picks, updated_at: values.updated_at };
}
