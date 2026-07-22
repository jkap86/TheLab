/** A Sleeper user as returned by `GET /v1/user/<username>`. */
export type SleeperUser = {
  user_id: string;
  username: string;
  display_name: string;
  /** Avatar id (not a URL); null when the user has no avatar. */
  avatar: string | null;
};

/** A league as returned by `GET /v1/user/<user_id>/leagues/nfl/<season>`. */
export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  previous_league_id: string | null;
  draft_id: string | null;
  roster_positions: string[] | null;
  settings: Record<string, unknown> | null;
  scoring_settings: Record<string, number> | null;
  metadata: Record<string, unknown> | null;
};

/** A team, from `GET /v1/league/<league_id>/rosters`. `owner_id` may be null. */
export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

/** A league member, from `GET /v1/league/<league_id>/users`. */
export type SleeperLeagueUser = {
  user_id: string;
  display_name: string;
  avatar: string | null;
  is_owner: boolean | null;
  is_bot: boolean | null;
  league_id: string;
  metadata: ({ team_name?: string } & Record<string, unknown>) | null;
};

/**
 * A future draft-pick asset, from `GET /v1/league/<league_id>/traded_picks`.
 * All three id fields are ROSTER ids (ints): `roster_id` is the pick's original
 * owner, `owner_id` holds it now, `previous_owner_id` held it before.
 */
export type SleeperTradedPick = {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
  previous_owner_id: number | null;
};

/** A draft, from `GET /v1/league/<league_id>/drafts`. */
export type SleeperDraft = {
  draft_id: string;
  league_id: string;
  season: string;
  status: string;
  type: string;
  start_time: number | null;
  draft_order: Record<string, number> | null;
  settings: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

/**
 * An entry from Sleeper's global players map (`GET /v1/players/nfl`). `full_name`
 * is null for team defenses. Only the fields we promote to columns are typed;
 * the rest of the (large) payload is preserved via the index signature.
 */
export type SleeperPlayer = {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  position: string | null;
  team: string | null;
  fantasy_positions: string[] | null;
  status: string | null;
  sport: string | null;
  [key: string]: unknown;
};

/** The whole players map, keyed by player_id. */
export type SleeperPlayerMap = Record<string, SleeperPlayer>;

/** A drafted player, from `GET /v1/draft/<draft_id>/picks`. */
export type SleeperDraftPick = {
  draft_id: string;
  pick_no: number;
  round: number;
  roster_id: number;
  player_id: string;
  /** user_id of the picker; may be an empty string for autopicks. */
  picked_by: string;
  metadata: Record<string, unknown> | null;
};

/**
 * A roster move, from `GET /v1/league/<league_id>/transactions/<week>`. Covers
 * waivers, free-agent adds/drops, trades, and commissioner moves. `adds`/`drops`
 * map player_id -> roster_id. `roster_ids`/`consenter_ids` are ROSTER ids (ints).
 * `leg` is the week the move belongs to; `created`/`status_updated` are epoch ms.
 */
export type SleeperTransaction = {
  transaction_id: string;
  type: string;
  status: string;
  leg: number;
  /** user_id of the manager who initiated the move; may be null. */
  creator: string | null;
  created: number | null;
  status_updated: number | null;
  roster_ids: number[] | null;
  consenter_ids: number[] | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: unknown[] | null;
  waiver_budget: unknown[] | null;
  settings: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Current NFL state, from `GET /v1/state/nfl`. In the offseason `week` is 0 and
 * `season_type` is "off"; during the season `week` tracks the current NFL week.
 */
export type SleeperNflState = {
  week: number;
  leg: number;
  season: string;
  season_type: string;
  display_week: number;
};
