import type {
  CompPlayerFacts,
  CompSeasonLine,
  CompWindowId,
} from "@/shared/contract";

import { UDFA_PICK, isStatField } from "./criteria.ts";
import type { CompField } from "./criteria.ts";

/**
 * One field of one row, read over one window.
 *
 * A row is the player's facts at a season plus his **series** — the seasons on
 * file up to and including that one, newest first, so `history[0]` is the
 * row's own season. Reading only what is at or before the row is the
 * constraint this module exists to keep: a career figure that included the
 * following season would score the comp on the very answer the payoff column
 * reveals.
 *
 * **A player with one season on file has one season, not a zero.** Every
 * window over such a row answers that single season, and the card marks it
 * (`rookie · 1 yr on file`, chip tag `1 yr`) rather than quietly averaging a
 * season he never played. Zero would be a claim: it would drag every
 * aggregate down and make "had not played yet" indistinguishable from
 * "played and did nothing".
 *
 * **A null stat is skipped inside an aggregate and answers null where the
 * whole window is null.** Target share, YPRR and snap share are not on file
 * for every season, and an average that counted an absent season as zero
 * would be the same claim one grain down.
 */
export type CompRow = {
  facts: CompPlayerFacts;
  /** Newest first; `history[0]` is the row's own season. Never empty. */
  history: readonly CompSeasonLine[];
};

export function windowValue(
  row: CompRow,
  field: CompField,
  window: CompWindowId,
): number | null {
  if (!isStatField(field)) return factValue(row.facts, field);

  const series = row.history
    .slice(0, spanOf(window, row.history.length))
    .map((line) => line[field])
    .filter((v): v is number => v !== null);
  if (series.length === 0) return null;

  if (window === "chigh") return Math.max(...series);
  return series.reduce((a, b) => a + b, 0) / series.length;
}

/**
 * How many seasons a window reads, given how many are on file.
 *
 * `last` is one; `avg2` is the row's season and the one before it; the two
 * career windows read everything. A window longer than the series reads the
 * series — the one-season rule above — and never pads it.
 */
function spanOf(window: CompWindowId, onFile: number): number {
  switch (window) {
    case "last":
      return 1;
    case "avg2":
      return Math.min(2, onFile);
    case "cavg":
    case "chigh":
      return onFile;
  }
}

/**
 * A fact's reading. The one fact that needs a rule is draft capital: an
 * undrafted player is read as {@link UDFA_PICK}, because "after everyone" is
 * an ordinal position on the board rather than an absence — see the constant.
 */
function factValue(facts: CompPlayerFacts, field: "age" | "draft" | "exp"): number {
  switch (field) {
    case "age":
      return facts.age;
    case "exp":
      return facts.exp;
    case "draft":
      return facts.draft ?? UDFA_PICK;
  }
}

/**
 * The tag a comp card's chip prints for a pair, or the empty string for a
 * windowless criterion, which says nothing.
 *
 * A rookie row says *why* its window collapsed rather than printing a tag it
 * did not honour: `1 yr` where the reader asked for a two-year average over a
 * player with one season on file.
 */
export function windowTag(
  windowed: boolean,
  window: CompWindowId,
  yearsOnFile: number,
  tag: string,
): string {
  if (!windowed) return "";
  if (yearsOnFile === 1 && window !== "last") return "1 yr";
  return tag;
}
