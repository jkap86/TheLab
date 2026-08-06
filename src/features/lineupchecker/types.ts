import type {
  LeagueMatchupPayload,
  ManagerMatchupsPayload,
  MatchupOpponentPayload,
} from "@/shared/contract";

/**
 * What this tool reads off the wire, aliased from the contract rather than
 * redeclared — the house rule every feature keeps, because a client-side copy of
 * a response shape drifts from the route without the compiler noticing.
 */
export type {
  LeagueMatchupPayload,
  ManagerMatchupsPayload,
  MatchupOpponentPayload,
};

/** One league's matchup, under the name the components read it by. */
export type LeagueMatchup = LeagueMatchupPayload;

/** The team on the other side of it. */
export type MatchupOpponent = MatchupOpponentPayload;
