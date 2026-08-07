import type { ManagerLeague } from "@/shared/manager";

import {
  isBestBall,
  leagueType,
  scoringValue,
  slotCount,
} from "../shared/league-filters/predicates.ts";
import { formatRuleValue } from "../shared/league-filters/summaries.ts";

/**
 * What kind of league a trade happened in, as a row of tokens on the card's
 * header line.
 *
 * A trade means different things in different rooms — a second-round pick is a
 * different asset in a 10-team redraft from what it is in a 14-team superflex
 * dynasty, and a tight end is a different asset again where the league pays a
 * premium for one. The board spans every crawled league, so the card had no way
 * to say which of those it was looking at beyond the league's name, which only
 * helps a reader who already knows the league.
 *
 * **Everything here is read through the league filters' own predicates rather
 * than off the blobs directly.** `slotCount`, `scoringValue`, `leagueType` and
 * `isBestBall` are what the filter dialog selects on, so a card saying
 * "1QB + SF" and a filter for `qb+sf ≥ 2` cannot come to different conclusions
 * about the same league — the drift a shared definition exists to stop. It also
 * means a new QB-eligible flex counts here the moment the solver learns it,
 * since those predicates read the derived slot vocabulary.
 *
 * Pure and tested: every runtime import is relative with an explicit `.ts`
 * extension, and the one cross-module dependency (`ManagerLeague`) arrives as an
 * erased `import type`.
 */

/**
 * Which kind of fact a token carries, which is the only thing that varies about
 * how one is drawn.
 *
 * `format` is what game this is — the type and best ball — and it reads a step
 * brighter, because it changes what a trade *means* rather than describing the
 * room it happened in. `config` is the lineup and scoring detail. Two tones and
 * no more: this run sits on a card that already counts three surfaces, and the
 * distinction is worth exactly one step of brightness.
 */
export type LeagueSpecTone = "format" | "config";

/** One token: what it says, what it means, and how brightly it is drawn. */
export type LeagueSpec = {
  /** Stable across renders and unique within a run — the React key. */
  key: string;
  /** What the token says, in the card's display face. */
  label: string;
  /**
   * The same fact spelled out, as the token's `title`.
   *
   * The desktop backstop the contracted player names already use: a token this
   * short is a abbreviation, and `TEP 0.5` is not self-explanatory to a reader
   * who has not met the filter that spells it `bonus_rec_te`.
   */
  title: string;
  tone: LeagueSpecTone;
};

/**
 * Sleeper's `settings.type` codes.
 *
 * Absent is 0 — Sleeper omits it for the standard redraft league — and
 * `leagueType` already folds that in, so the only way to miss this table is a
 * format Sleeper has added since. That token is **dropped** rather than falling
 * back to redraft: naming a league as something it is not is worse on this card
 * than saying nothing, since the whole point of the run is what game is being
 * played.
 */
const TYPE_LABELS: Record<number, string> = {
  0: "Redraft",
  1: "Keeper",
  2: "Dynasty",
  3: "Chopped",
};

/** `1 quarterback`, `2 quarterbacks` — for the titles, which are read aloud. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * How a league's quarterback lineup reads: `1QB`, `1QB + SF`, `2QB`, `SF`.
 *
 * The two counts are kept apart rather than summed into "superflex or not",
 * because they are different rooms: a league starting two bare QB slots forces
 * a second quarterback into the lineup every week, where a superflex slot only
 * *permits* one — the same distinction the filters draw by offering `QB` and
 * `SUPER_FLEX` as separate groups beside the combined `QB+SF`.
 *
 * A count above one is spelled out on both halves (`2QB + 2SF`), which no league
 * seen here runs and which costs nothing to be right about.
 */
export function qbSlotLabel(qb: number, sf: number): string {
  if (sf === 0) return `${qb}QB`;
  const superflex = sf === 1 ? "SF" : `${sf}SF`;
  return qb === 0 ? superflex : `${qb}QB + ${superflex}`;
}

/**
 * The tokens for a league, in the order they are drawn — or an empty run for a
 * league the list hasn't answered for yet.
 *
 * **The always-present facts lead, in a fixed order, and the conditional ones
 * trail.** This run is read down a list rather than across one card, so a
 * reader checking "is this dynasty" wants the answer in the same position on
 * every card; putting best ball first would move every other token one place
 * left on the minority of cards that have it. Type, size, quarterbacks and
 * tight ends are that fixed spine, and TE premium and best ball follow it.
 *
 * **A fact that isn't known is omitted, never printed as zero.** `slotCount`
 * answers null for a league whose `roster_positions` were never synced, which
 * is not evidence that it starts no tight end — the same rule that keeps
 * `k = 0` from sweeping in every unsynced league in the filters. So the lineup
 * tokens simply aren't drawn there, and the run is shorter rather than wrong.
 */
export function leagueSpecs(league: ManagerLeague | null): LeagueSpec[] {
  if (!league) return [];

  const specs: LeagueSpec[] = [];

  const typeLabel = TYPE_LABELS[leagueType(league)];
  if (typeLabel) {
    specs.push({
      key: "type",
      label: typeLabel,
      title: `${typeLabel} league`,
      tone: "format",
    });
  }

  // A league with no rosters is not a league; the guard is against a zero
  // arriving from a row stored before the column was filled rather than against
  // anything Sleeper sends.
  if (league.total_rosters > 0) {
    specs.push({
      key: "teams",
      label: `${league.total_rosters} Team`,
      title: `${league.total_rosters}-team league`,
      tone: "config",
    });
  }

  const qb = slotCount(league, "QB");
  const sf = slotCount(league, "SUPER_FLEX");
  if (qb !== null && sf !== null) {
    specs.push({
      key: "qb",
      label: qbSlotLabel(qb, sf),
      title:
        sf === 0
          ? `Starts ${plural(qb, "quarterback")}`
          : qb === 0
            ? `Starts ${plural(sf, "superflex slot")}`
            : `Starts ${plural(qb, "quarterback")} plus ${plural(sf, "superflex slot")}`,
      tone: "config",
    });
  }

  const te = slotCount(league, "TE");
  if (te !== null) {
    specs.push({
      key: "te",
      label: `${te}TE`,
      title: `Starts ${plural(te, "tight end")}`,
      tone: "config",
    });
  }

  // Absent from a stored `scoring_settings` is 0 — Sleeper omits what a league
  // doesn't pay for, which is exactly why `bonus_rec_te > 0` is how the filters
  // ask this. The rate travels with the token: half a point and a full point
  // are different leagues, and "TEP" alone would call them the same one.
  const tep = scoringValue(league, "bonus_rec_te");
  if (tep !== null && tep > 0) {
    const rate = formatRuleValue(tep);
    specs.push({
      key: "tep",
      label: `TEP ${rate}`,
      title: `TE premium — ${rate} extra per tight end reception`,
      tone: "config",
    });
  }

  // Only when true. Lineup is the overwhelming default, and a token on nearly
  // every card is a token that says nothing — the same reason the league
  // filters' summary names a selection and not the absence of one.
  if (isBestBall(league)) {
    specs.push({
      key: "best_ball",
      label: "Best ball",
      title: "Best ball — lineups are scored automatically",
      tone: "format",
    });
  }

  return specs;
}
