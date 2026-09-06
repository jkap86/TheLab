import type { KtcFormat } from "./ktc";
import type {
  LeaguematePayload,
  PlayerShareSummary,
  PlayerSummary,
} from "./names";

/**
 * The three shares reads: which of a manager's leagues hold which players,
 * which of them hold which people, and — for the two questions those cannot
 * answer between them — what everybody *else* in those leagues holds.
 *
 * **No route here counts anything, and that is the whole design.** A share is
 * folded on the client from these raw maps, because the manager page narrows
 * its league list — Type, Format, Settings, Roster slots, Scoring — and a share
 * has to be counted over *the leagues left*. A server-side `GROUP BY` would
 * answer a different question and could not be re-asked without a round trip
 * per filter press. Two of the three maps are small enough for that to be the
 * cheap option outright: on a 113-league account, ~3,400 roster ids and ~1,300
 * member ids. The third is every roster of every league, which is an order of
 * magnitude more — and is why all three sit behind the drawer's `opened` latch
 * rather than being fetched with the page.
 *
 * The counting rules that go with them live in `features/manager/helpers` —
 * `shares.ts`, `leaguemates.ts` and `leaguemate-rosters.ts` — because they are
 * pure and they are the kind of rule that is silent when wrong.
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

/**
 * `GET /api/user/[username]/leaguemate-rosters` — every roster in those
 * leagues, not just the manager's own.
 *
 * The third shares read, and the one the other two could not be widened into.
 * `ManagerPlayersPayload.rosters` is the manager's rosters alone and
 * `ManagerLeaguematesPayload.members` is bare membership with no players, so
 * neither can answer "what does this leaguemate hold" or "does anybody in this
 * league hold him". `ManagerLineupsPayload` does carry every team's solved
 * lineup, and cannot answer it either: `LeagueTeam` keys a team by `roster_id`
 * with no `user_id`, so it cannot be joined to a person.
 *
 * **It counts nothing**, on the two routes beside it's exact terms: the folds
 * live in `features/manager/helpers/leaguemate-rosters.ts` and run over the
 * league-filtered list, because a share counted over anything but the leagues
 * in front of the reader is a different question.
 *
 * **It is an order of magnitude larger than the other two** — every roster of
 * every league rather than one per league — which is why it is behind the same
 * `opened` latch and never fetched on page load.
 */
export type ManagerLeaguemateRostersPayload = {
  season: string;
  /**
   * league id → every stored roster in it.
   *
   * **A list of rosters rather than a map keyed by user id**, which is the one
   * place this diverges from the shape the design sketched, and for two
   * reasons the data itself forces. `rosters.owner_id` is **nullable** — an
   * orphan team is a real row holding real players — and a map keyed by user
   * would have to either drop those players (so a player on an orphan roster
   * would read as *available*, which is false) or invent a key for them. And
   * Sleeper can answer with two rosters for one owner in one league, which a
   * map would silently collapse to one.
   *
   * The two questions the folds ask read it differently and both are exact
   * here: **taken** is a roster whose `user_id` is somebody else's, where an
   * orphan team is nobody; **available** is *no* roster naming him at all,
   * orphan teams included.
   *
   * `players` is Sleeper's array verbatim — IR and taxi included, its `""` /
   * `"0"` slot padding not stripped, which the folds drop.
   *
   * **A league absent from this map has no stored rosters**, and that is a
   * third state rather than an empty one: nothing can be said to be available
   * in a league nobody has read, so the folds skip it rather than counting it.
   */
  rosters: Record<string, LeagueRosterEntry[]>;
  /**
   * Names for every id named above — the chip rail's whole vocabulary.
   *
   * **The route ships its own summaries rather than borrowing the players
   * payload's**, which is not a duplication so much as a different question:
   * that map names the ids on the *manager's* rosters, and most of what a
   * leaguemate holds is not on one. A chip drawn from it would fall back to a
   * raw id for the majority of a roster.
   *
   * {@link PlayerSummary} rather than {@link PlayerShareSummary}: a chip is a
   * name, a position and a team, and an age and a price for two thousand
   * players is wire weight nothing here renders.
   */
  players: Record<string, PlayerSummary>;
};

/** One stored roster, as {@link ManagerLeaguemateRostersPayload} carries it. */
export type LeagueRosterEntry = {
  /** Sleeper's own roster id, unique within the league. */
  roster_id: number;
  /** Who holds it, or **null for an orphan team** — see the note above. */
  user_id: string | null;
  players: string[];
};
