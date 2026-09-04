import type { KtcFormat } from "./ktc";
import type { LeaguematePayload, PlayerShareSummary } from "./names";

/**
 * The two shares reads: which of a manager's leagues hold which players, and
 * which of them hold which people.
 *
 * **Neither route counts anything, and that is the whole design.** A share is
 * folded on the client from these raw maps, because the manager page narrows
 * its league list — Type, Format, Settings, Roster slots, Scoring — and a share
 * has to be counted over *the leagues left*. A server-side `GROUP BY` would
 * answer a different question and could not be re-asked without a round trip
 * per filter press. The maps are small enough for that to be the cheap option:
 * on a 113-league account, ~3,400 roster ids and ~1,300 member ids.
 *
 * The counting rules that go with them live in `features/manager/helpers` —
 * `shares.ts` and `leaguemates.ts` — because both are pure and both are tested.
 */

/** `GET /api/user/[username]/players` — every roster the manager holds. */
export type ManagerPlayersPayload = {
  season: string;
  /**
   * league id → the player ids on the manager's roster there, Sleeper's array
   * verbatim: **IR and taxi included**, and its `""` / `"0"` slot padding not
   * stripped, which the fold does.
   *
   * **A league absent from this map is not a league holding nobody.** It has no
   * stored roster, and the fold must skip it rather than count a zero — which
   * is what keeps the denominator honest on a partly-synced account.
   */
  rosters: Record<string, string[]>;
  /**
   * Player ids → name/position/team plus the drawer's three figures, for every
   * id named above. A missing id is simply absent, never a placeholder row: the
   * fold has the id in hand and shows it, which is a searchable token rather
   * than an empty cell.
   */
  players: Record<string, PlayerShareSummary>;
  /**
   * Which KeepTradeCut market every `ktc_value` above was read on, and when
   * those rows were scraped. **Null when no board could be read**, which is
   * what turns the drawer's Value column into a column of em dashes rather than
   * a column of zeroes.
   *
   * **One board for the whole panel, and it has to be**, which is the one place
   * this payload differs in kind from the lineups one. There a price is per
   * league, so `auto` resolves per league and the payload can answer `"mixed"`;
   * here a row *spans* leagues, so there is no league to resolve against and a
   * single figure has to name a single market — `auto` reads dynasty, the board
   * with pick rows and the one a cross-league comparison implies. Averaging the
   * two would be the pooled-ADP bug in a second place.
   *
   * `superflex` is false and is stated rather than assumed for the same reason.
   * Which of KTC's two QB columns a league reads is a fact about that league,
   * and a shares row is not one — so the panel fixes the 1QB column and says
   * so, rather than letting a price move when a filter does.
   */
  ktc: {
    board: KtcFormat;
    superflex: false;
    /** ISO 8601; null when the board matched nothing. */
    updated_at: string | null;
  } | null;
};

/** `GET /api/user/[username]/leaguemates` — who is in those leagues. */
export type ManagerLeaguematesPayload = {
  season: string;
  /**
   * league id → the user ids in it, **the manager's own included**.
   *
   * Keeping it is deliberate and is the mirror of the rule above: the
   * manager's presence is what separates "this league is cached and they share
   * it with nobody" from "this league has no member rows". The fold drops them
   * from the list it builds. `getLeaguemateIds` excludes them instead, because
   * there the id list *is* the answer rather than a population to count over.
   */
  members: Record<string, string[]>;
  users: Record<string, LeaguematePayload>;
};
