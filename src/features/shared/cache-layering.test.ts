import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COMPS_POOL_CACHE } from "../../shared/comps/read-cache.ts";
import {
  ADP_BOARD_CACHE,
  ADP_PLAYER_BOARD_CACHE,
  LEAGUE_DETAIL_CACHE,
  MANAGER_RANKS_CACHE,
} from "../../shared/manager/read-cache.ts";
import { COMPS_STALE_TIMES } from "../comps/comps-query.ts";
import { ADP_STALE_TIMES } from "./adp-query.ts";
import { LEAGUE_DETAIL_STALE_TIME } from "./league-query.ts";
import { MANAGER_STALE_TIMES } from "./manager-query.ts";

/**
 * Which way round the two caches over one answer go.
 *
 * Every expensive read in this app is read through two caches and neither knows
 * about the other. The browser's is a `staleTime` in `features/`; the server's
 * is a `TtlPromiseCache` policy in `shared/`, and `shared/` may never import
 * `features/` — so the constants are two modules apart with no compiler link
 * between them, and their *relationship* is the thing neither file can assert
 * about itself. This is the file that can name both.
 *
 * **The relationship is `client stale < server TTL`, and it had drifted to the
 * opposite of that in three places out of four**, with each comment still
 * claiming the rule it was breaking. Written out, why the ordering is not
 * symmetrical:
 *
 * - A browser entry going stale does not discard anything. React Query
 *   revalidates — one request, with the stale rows still on screen — so what
 *   `staleTime` really schedules is *when this app's own server is next asked*.
 * - That request is what the server cache exists to absorb. Held there, it costs
 *   a memory read for every reader, tab and process-mate at once.
 * - A server entry going stale is the expensive half: four queries for a league
 *   panel, a second of aggregate over ~1.5M picks for a board, a lineup solve
 *   per team per remaining week for a manager's ranks.
 *
 * So with the server TTL *shorter*, the first revalidation after a client entry
 * goes stale is a guaranteed miss, and the layer built to absorb revalidations
 * expires just in time to miss every one of them.
 *
 * **A gap of merely more than zero is not enough**, which is the second thing
 * these tests pin. Nothing lines the two clocks up: the client entry is stamped
 * when its request *resolved*, the server's when the computation *started*, and
 * a second reader arrives wherever they arrive. A request landing uniformly
 * inside an entry's life finds `(ttl − stale) / ttl` of it left, so a server TTL
 * a minute over the client's still misses most of the time. {@link MIN_OVERLAP}
 * is the floor, and it is a ratio rather than a duration because that is what
 * the arithmetic depends on.
 *
 * What is *not* asserted here is freshness after an explicit action. Neither
 * clock decides that: a league refresh drops the server entry at the write
 * (`persistLeagueGraph`) and the client entry at the response
 * (`useLeagueRefresh`), and a manager's leagues sync does the same for their
 * ranks. Those paths are exact, which is what lets these TTLs be set for the
 * background writes they are actually stale about.
 */

/**
 * How much of the client's window the server entry must outlive it by.
 *
 * 1.5× is the floor, not the target: it leaves a third of the server entry's
 * life as the window a revalidation can arrive in and still hit, which absorbs
 * the offset between two readers' clocks without pretending to guarantee a hit.
 * The layers here sit at 1.6×, 2× and 3× — a number chosen per read from what
 * writes underneath it, not one ratio applied to everything.
 */
const MIN_OVERLAP = 1.5;

/**
 * Every answer this app holds in two caches at once.
 *
 * `cost` is not asserted on; it is here because it is the reason each pair is
 * ordered this way, and a table of numbers with the stakes left out is one
 * somebody tunes toward zero.
 */
const LAYERS = [
  {
    what: "League Details (core, and the three enrichments derived from it)",
    client: LEAGUE_DETAIL_STALE_TIME,
    server: LEAGUE_DETAIL_CACHE.ttlMs,
    cost: "four queries, ×4 for a panel's four routes on a cold key",
  },
  {
    what: "the paged ADP board",
    client: ADP_STALE_TIMES.board,
    server: ADP_BOARD_CACHE.ttlMs,
    cost: "~500-600ms of aggregate over ~1.5M picks, plus a count statement",
  },
  {
    what: "a priced ADP board, as the manager's valuation reads it",
    client: MANAGER_STALE_TIMES.adpValue,
    server: ADP_PLAYER_BOARD_CACHE.ttlMs,
    cost: "the same aggregate, narrowed to a roster's ids",
  },
  {
    what: "a priced ADP board, as the league panel's value columns read it",
    client: LEAGUE_DETAIL_STALE_TIME,
    server: ADP_PLAYER_BOARD_CACHE.ttlMs,
    cost: "the same aggregate again — two client windows, one server entry",
  },
  {
    what: "a manager's ranks",
    client: MANAGER_STALE_TIMES.ranks,
    server: MANAGER_RANKS_CACHE.ttlMs,
    cost: "a lineup solve per team per remaining week, per league, on the web process",
  },
  {
    what: "a comps season pool",
    client: COMPS_STALE_TIMES.result,
    server: COMPS_POOL_CACHE.ttlMs,
    cost: "an assembled pool per stored season, every season per request",
  },
] as const;

describe("cache layering", () => {
  for (const layer of LAYERS) {
    describe(layer.what, () => {
      test("the server holds it longer than the browser calls it fresh", () => {
        assert.ok(
          layer.server > layer.client,
          `server ${ms(layer.server)} must outlive client ${ms(layer.client)}, ` +
            `or every revalidation misses and pays: ${layer.cost}`,
        );
      });

      test("by enough that a revalidation is not a coin toss", () => {
        assert.ok(
          layer.server >= layer.client * MIN_OVERLAP,
          `server ${ms(layer.server)} is only ${(layer.server / layer.client).toFixed(2)}× ` +
            `client ${ms(layer.client)}; ${MIN_OVERLAP}× is the floor`,
        );
      });
    });
  }

  test("the client's own windows stay short enough to be revalidations", () => {
    // The other end of the rule, and the one a long server TTL invites
    // forgetting: the layering is not an argument for holding everything for
    // ages, it is an argument for the *order* of two windows. A browser entry
    // fresh for half an hour is a reader who does not see a league sync land
    // until they navigate, whatever the server holds.
    for (const layer of LAYERS) {
      assert.ok(
        layer.client <= 15 * 60 * 1000,
        `${layer.what}: a browser entry fresh for ${ms(layer.client)} is not a cache, it is a snapshot`,
      );
    }
  });

  test("no server entry outlives the reader's session by an order of magnitude", () => {
    // The ceiling on the same rule. Per-read ceilings — against the crawler's
    // tier, against the projections sync — are asserted in each side's own
    // policy test; this is the blunt one that catches a number typed with an
    // extra zero.
    for (const layer of LAYERS) {
      assert.ok(
        layer.server <= 60 * 60 * 1000,
        `${layer.what}: ${ms(layer.server)} in memory is a deploy-scoped answer`,
      );
    }
  });
});

const ms = (value: number): string => `${Math.round(value / 1000)}s`;
