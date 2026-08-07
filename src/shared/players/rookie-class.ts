import { getRookiePlayerIds } from "./queries";

/**
 * Naming a rookie class — the seam future historical-class support goes behind.
 *
 * **How rookie picks are identified today, end to end.** `/api/adp` asks this
 * module which of a board's players are rookies and sends the answer as
 * `AdpPlayerPayload.rookie`; `rookieLadder` (`features/shared/pick-value`)
 * ranks exactly those rows into the pick ladder, so the k-th rookie off the
 * rookie-draft board *is* rookie pick k; and the drawer labels the ladder with
 * `classSeason` — always the **active** season, passed down as `defaultSeason`.
 * The only source any of it rests on is `players.years_exp = 0`, a fact about
 * *now*: the players map is replaced daily and carries no history.
 *
 * **What prevents historical rookie ADP from working**, precisely:
 *
 * 1. **No stored fact names a past class.** `years_exp` counts completed
 *    seasons as of the last sync, so the 2024 class is not recoverable from the
 *    cache — `activeSeason − years_exp` is an inference, wrong for anyone whose
 *    count didn't advance (a missed season, a practice-squad year, a return
 *    from out of the league). A wrong *inclusion* shifts every rung below it,
 *    the one error in a ladder that propagates, so a derivation right for most
 *    players is worse than an empty ladder that says so.
 * 2. **The route cannot always resolve "which class" for a historical board.**
 *    An explicitly requested season never consults `getActiveSeason` (the
 *    house rule about requested seasons, kept by evaluation order), so on a
 *    historical read the route holds no active season to subtract from even if
 *    the inference above were sound.
 * 3. **The client's labels assume the current class.** `classSeason` is the
 *    active season everywhere the ladder is drawn; a payload that marked a past
 *    class without saying which season it names would mislabel every pick row.
 *
 * Doing it properly wants a persisted `rookie_season` column written at sync
 * time, backfilled from a source better than `years_exp` — a schema change,
 * deliberately out of scope here. What this module fixes in the meantime is
 * the *shape*: the question is asked as "the members of {@link RookieClass}
 * among these ids", so when a real source exists, implementing the
 * `{ kind: "season" }` arm (and sending the season alongside `rookie` on the
 * payload) is the whole of the change — no caller has to be re-taught what a
 * rookie flag means.
 */
export type RookieClass =
  /** The class that is a rookie *now* — the only class the cache can name. */
  | { kind: "current" }
  /**
   * A named season's class. Unanswerable today (see the module note); kept in
   * the vocabulary so the seam states the question historical support answers.
   */
  | { kind: "season"; season: string };

export const CURRENT_ROOKIE_CLASS: RookieClass = { kind: "current" };

/**
 * Which of `ids` belong to `rookieClass`.
 *
 * The current class is `years_exp = 0` ({@link getRookiePlayerIds}, where the
 * absent-is-unknown rule is documented). A named season answers **empty** —
 * "cannot name that class", never a guess — which downstream reads as picks
 * being unpriced (`no-ladder`), the honest answer the current behaviour
 * already gives a historical board by construction: none of today's rookies
 * appear in a past season's drafts, so the flag never marks a row there.
 */
export async function getRookieClassIds(
  ids: string[],
  rookieClass: RookieClass = CURRENT_ROOKIE_CLASS,
): Promise<Set<string>> {
  if (rookieClass.kind === "season") return new Set();
  return getRookiePlayerIds(ids);
}
