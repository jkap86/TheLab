// Sleeper's players map, stored and read back. **Server-only** — it reaches
// Postgres and Sleeper both. A client module naming a player wants
// `PlayerSummary` from `@/shared/contract`, which is where that shape lives.

export { getMatchablePlayers, getPlayersByIds } from "./queries";
export type { MatchablePlayer } from "./queries";
export { PLAYERS_SYNC_VAR, startPlayersScheduler } from "./scheduler";
export { toPlayerSummary } from "./summary";
export type { PlayerNameRow } from "./summary";
export { PLAYERS_TTL_MS, ensurePlayersFresh, syncPlayers } from "./sync";
export type { PlayersSyncSummary } from "./sync";
