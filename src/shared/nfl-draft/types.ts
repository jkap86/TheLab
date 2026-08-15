/**
 * What this app stores about a player's NFL draft position.
 *
 * Shared by the parser, the validator and the queries, so the shape the
 * crosswalk is read into is the shape the table holds and the shape the comps
 * pool joins — one definition rather than three that agree by inspection.
 */

/**
 * One player's place in the NFL draft, keyed by Sleeper id.
 *
 * **`overall === null` means undrafted, never unknown.** An unknown player has
 * no `NflDraftPick` at all, which is the distinction the table draws with row
 * presence and the reason this type has no `undrafted` flag: a boolean beside a
 * nullable number is two spellings of one fact, and the failure mode is that
 * they disagree. Callers that need "is this an answer" ask whether they got a
 * record; callers that need "was he drafted" ask whether `overall` is null.
 */
export type NflDraftPick = {
  /** Sleeper's player id — the key every reader already holds. */
  playerId: string;
  /** The draft class. Always known: a row with no class is never stored. */
  season: string;
  /**
   * Round, and the pick within that round. Null exactly when `overall` is —
   * an undrafted player has no place in either.
   *
   * `slot` is nullable on its own too, because the crosswalk occasionally
   * carries a round for a player it has no in-round slot for; `overall` and
   * `round` are what the schema requires together.
   */
  round: number | null;
  slot: number | null;
  /** Overall pick number, or null for an undrafted player. */
  overall: number | null;
};
