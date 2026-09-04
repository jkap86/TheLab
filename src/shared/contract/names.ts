/**
 * The two ways this app names somebody: a player, and a league member.
 *
 * Both were declared in `trades.ts`, where the trades board was the only reader.
 * The shares drawers are the second, and a name with two readers should not live
 * in one of their modules — the barrel re-exports either way, so nothing that
 * imports `@/shared/contract` changed when they moved.
 *
 * They are here rather than in `shared/players` / `shared/manager` for the
 * folder's own reason: a `"use client"` module must be able to name a payload
 * without pulling a database client into the browser. Those modules import these
 * shapes back with `import type`.
 */

/**
 * A player as anything that names one renders them.
 *
 * `name` is never null — an unnamed row falls back to the id, which is a
 * visible, searchable token rather than an empty cell, and is what a reader can
 * act on when the players table is behind Sleeper's map.
 */
export type PlayerSummary = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
};

/**
 * A player as the shares drawer reads him: the summary above, plus the three
 * figures its Value, Age and Class columns are drawn from.
 *
 * **A sibling type rather than three more fields on {@link PlayerSummary}**,
 * because the trades board is that type's other reader and none of these three
 * is a fact it asks for: a trade names players who have since retired, and
 * shipping an age and a price for each of them would be wire weight nothing on
 * that page renders. The shares payload is the one place they are wanted, so it
 * is the one payload that carries them.
 *
 * All three are **null where the answer is absent, never zero** — the rule the
 * whole app is written on. An unpriced player is the ordinary case (KTC's
 * boards are a churning few hundred skill players), a defence has no age, and a
 * draft class is only as good as what Sleeper stored.
 */
export type PlayerShareSummary = PlayerSummary & {
  /** Sleeper's own `age`, as it stores it. Null where it has none. */
  age: number | null;
  /**
   * The season this player came into the league, **as Sleeper recorded it** —
   * `metadata.rookie_year` and nothing else.
   *
   * It is deliberately not derived from `years_exp`. `activeSeason - years_exp`
   * covers many more players and is wrong for anyone who went undrafted or
   * missed a season, and a wrong year on a dynasty page is worse than an absent
   * one — the same call `resolveSleeperIds` makes when it leaves an ambiguous
   * KTC row unmatched. The derivation is available if somebody measures its
   * error against the stored map first.
   */
  draft_class: number | null;
  /**
   * KeepTradeCut's price, on the one board named by `ManagerPlayersPayload.ktc`
   * — never an average of the two markets, which would be three scales sharing
   * a column.
   */
  ktc_value: number | null;
};

/**
 * A league member as sent to the client (avatar id resolved to a URL).
 *
 * `display_name` is nullable where the stored `league_users` row has none; a
 * reader falls back to the id, on `PlayerSummary`'s rule.
 */
export type LeaguematePayload = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};
