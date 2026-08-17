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
   * The **structural** half: the league, its rosters and standings, its members
   * and picks, and the names its player ids resolve to.
   *
   * **It depends on neither the ADP board nor the week, and that is the whole
   * point of it being its own entry.** There used to be one key carrying both,
   * because there was one payload carrying both — so narrowing the drawer or
   * stepping a week re-fetched a dozen rosters and several hundred player names
   * to move two columns. Split, a board change invalidates {@link values} alone
   * and a week change {@link week} alone, and the panel's rows never flicker
   * because they were never re-asked for.
   */
  core: (leagueId: string) => [...leagueQueryKeys.league(leagueId), "core"] as const,

  /**
   * Its two value columns, on one ADP board.
   *
   * The board is normalised the way the drawer's own board key is, so two
   * spellings of one population are one entry rather than two round trips.
   */
  values: (leagueId: string, board: string) =>
    [...leagueQueryKeys.league(leagueId), "values", normalizeAdpQuery(board)] as const,

  /** Its rest-of-season lineups — a fact about the league and nothing else. */
  outlook: (leagueId: string) =>
    [...leagueQueryKeys.league(leagueId), "outlook"] as const,

  /**
   * One week of it, for the lineup checker.
   *
   * A panel opened on a season never makes this request at all, which is the
   * honest spelling of the `week === null` case the old single key had to carry
   * as a `"season"` segment.
   */
  week: (leagueId: string, week: number) =>
    [...leagueQueryKeys.league(leagueId), "week", week] as const,
};

/**
 * How long a league's detail is worth reusing in the browser.
 *
 * Five minutes, the value it held in the manager area's own `STALE_TIMES` table
 * and for the same reason: the panel mounts on expand and unmounts on collapse,
 * so a league opened, closed and opened again should cost one request rather than
 * three.
 *
 * **Shorter than the server's own TTL on purpose, and the ordering is the whole
 * design of the pair.** When this lapses React Query revalidates — one cheap
 * request, with the rows it already holds still on screen — and the point is for
 * that request to land in `LEAGUE_DETAIL_CACHE`, which holds the same answer in
 * the server's memory for eight minutes. So a stale read here costs a request
 * answered from memory, where a stale read *there* costs four queries. The two
 * were once the other way round (three minutes behind this five), which made
 * every revalidation a guaranteed miss on the layer built to absorb it; the
 * ordering is asserted in `cache-layering.test.ts` rather than left to these
 * comments.
 *
 * Neither number is what keeps a *press* honest. `useLeagueRefresh` invalidates
 * this key on the way back from a sync, and the server drops its own entry when
 * the graph is written — see `persistLeagueGraph` — so a reader who asks for a
 * refresh sees Sleeper's answer whatever either clock says.
 *
 * It travels with the key rather than staying in that table because that table is
 * "how long the *manager area's* answers are worth reusing", and this answer
 * stopped being one of them when a second tool started opening the same panel.
 *
 * **One number for all four entries**, which is a claim rather than an
 * omission: the enrichments are computed *from* the core read, so a window in
 * which the rosters are worth reusing is exactly the window in which a lineup
 * solved over them is. Giving the outlook a longer TTL than the rosters it was
 * solved from is how a panel comes to show last week's lineup beside this
 * week's roster.
 */
export const LEAGUE_DETAIL_STALE_TIME = 5 * 60 * 1000;
