/**
 * Where one league's standings-and-rosters read is filed, and how long a browser
 * is allowed to reuse it.
 *
 * It sits here rather than in `features/manager/query-keys.ts`, where it was
 * written, for the reason `schedule-query.ts` does: the league detail panel is
 * drawn by a second tool now — the trades board opens a card into the same
 * standings — and a key built inside a feature that a shared component has to
 * call is a key that feature can no longer own. Nothing about its shape changed;
 * it was never manager-scoped in the first place, since `/api/league/[leagueId]`
 * answers about a league and asks about no account at all. `query-keys.ts`
 * re-exports it for the consumers, its own tests among them, that already read it
 * from there.
 *
 * Pure, and imported relatively with a `.ts` extension by the tests that hash
 * these keys.
 */
import { normalizeAdpQuery } from "./adp-query.ts";

/** `/api/league/[leagueId]` — the expanded card's standings and rosters. */
export const leagueQueryKeys = {
  all: ["league"] as const,

  /**
   * Every board of one league's detail — the prefix, not an entry. It is what
   * lets {@link leagueQueryKeys.detail}'s consumer tell "a different board of the
   * league already on screen" from "a different league": the first keeps its rows
   * while the next answer lands, the second must not.
   */
  league: (leagueId: string) => [...leagueQueryKeys.all, leagueId] as const,

  /**
   * One board of it. The rosters and standings don't depend on the board at all
   * — only the two value columns do — but they arrive on one payload, so the
   * board has to reach the key or a narrowed drawer would be served the previous
   * board's prices.
   */
  detail: (leagueId: string, board: string) =>
    [...leagueQueryKeys.league(leagueId), normalizeAdpQuery(board)] as const,
};

/**
 * How long a league's detail is worth reusing in the browser.
 *
 * Five minutes, the value it held in the manager area's own `STALE_TIMES` table
 * and for the same reason: the panel mounts on expand and unmounts on collapse,
 * so a league opened, closed and opened again should cost one request rather than
 * three. Shorter than the server's own TTLs on purpose — a stale client read
 * costs a request the server answers from its cache, where a stale server read
 * costs a fetch to somebody else.
 *
 * It travels with the key rather than staying in that table because that table is
 * "how long the *manager area's* answers are worth reusing", and this answer
 * stopped being one of them when a second tool started opening the same panel.
 */
export const LEAGUE_DETAIL_STALE_TIME = 5 * 60 * 1000;
