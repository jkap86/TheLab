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
