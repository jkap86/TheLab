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
 * window over such a row answers that single season, and the reading says so
 * (`used: 1, of: 1`) rather than quietly averaging a season he never played.
 * Zero would be a claim: it would drag every aggregate down and make "had not
 * played yet" indistinguishable from "played and did nothing".
 *
 * **A null stat is skipped inside an aggregate and answers null where the
 * whole window is null.** Target share, YPRR and snap share are not on file
 * for every season, and an average that counted an absent season as zero
 * would be the same claim one grain down.
 *
 * **And an aggregate says how much of its window it actually had**, which is
 * the rule this module gained when the corpus stopped being a hand-written
 * sample. A two-year average over `[0.28, null]` is one season's figure, and
 * presented as a two-year average it is a number the reader believes twice as
 * much as they should. {@link windowReading} carries `used` and `of` beside
 * the value; every caller that prints a window tag or measures comparison
 * coverage reads them rather than assuming the window was honoured.
 */
export type CompRow = {
  facts: CompPlayerFacts;
  /** Newest first; `history[0]` is the row's own season. Never empty. */
  history: readonly CompSeasonLine[];
};

/**
 * A field read over a window, with the observations behind it.
 *
 * `of` is what the window asked for **on this row** — a two-year window over a
 * rookie asks for one season, because one is all there is to ask for, and a
 * reading of `1 of 1` is complete where `1 of 2` is partial. `used` is how
 * many of those seasons carried a value, and is `0` exactly when `value` is
 * null. A windowless field (age, draft slot, experience) is `1 of 1`: it is a
 * fact about the row's own season and has no other reading.
 */
export type WindowReading = {
  value: number | null;
  /** Seasons that carried a value. Zero iff `value` is null. */
  used: number;
  /** Seasons the window asked for, given this row's series. */
  of: number;
};

/** {@link windowReading}'s value alone, for callers with no use for the counts. */
export function windowValue(
  row: CompRow,
  field: CompField,
  window: CompWindowId,
): number | null {
  return windowReading(row, field, window).value;
}

export function windowReading(
  row: CompRow,
  field: CompField,
  window: CompWindowId,
): WindowReading {
  if (!isStatField(field)) {
    const value = factValue(row.facts, field);
    return { value, used: value === null ? 0 : 1, of: 1 };
  }

  const of = spanOf(window, row.history.length);
  const series = row.history
    .slice(0, of)
    .map((line) => line[field])
    .filter((v): v is number => v !== null);
  if (series.length === 0) return { value: null, used: 0, of };

  const value =
    window === "chigh"
      ? Math.max(...series)
      : series.reduce((a, b) => a + b, 0) / series.length;
  return { value, used: series.length, of };
}

/**
 * How many seasons a window reads, given how many are on file.
 *
 * `last` is one; `avg2` is the row's season and the one before it; the two
 * career windows read everything. A window longer than the series reads the
 * series — the one-season rule above — and never pads it, which is why `of`
 * is 1 rather than 2 for a rookie's two-year window: it asked for what there
 * was to ask for and got all of it.
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
 * A fact's reading. The one fact that needs a rule is draft capital, and it
 * has two arms that must not be folded into one: a player *known* to have
 * gone undrafted is read as {@link UDFA_PICK}, because "after everyone" is an
 * ordinal position on the board rather than an absence — see the constant —
 * while a slot nobody could supply is **null**, which the distance treats as
 * it treats a null target share: the pair is absent from the row rather than
 * scored. Reading the second as the first is how a corpus loaded from a source
 * with no draft column printed every player in it as a UDFA.
 */
function factValue(
  facts: CompPlayerFacts,
  field: "age" | "draft" | "exp",
): number | null {
  switch (field) {
    case "age":
      return facts.age;
    case "exp":
      return facts.exp;
    case "draft":
      if (facts.draft === null) return null;
      return facts.draft === "udfa" ? UDFA_PICK : facts.draft;
  }
}

/**
 * The tag a comp card's chip prints for a pair, or the empty string for a
 * windowless criterion, which says nothing.
 *
 * A rookie row says *why* its window collapsed rather than printing a tag it
 * did not honour: `1 yr` where the reader asked for a two-year average over a
 * player with one season on file.
 *
 * This is the reading available from the row's length alone. Where the pair's
 * own counts are in hand — every comp card has them — {@link observationTag}
 * is the more precise answer, because it also catches the window that had two
 * seasons to read and a value in only one of them.
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

/**
 * The tag a pair prints given what it actually read: the window's own tag when
 * every season it asked for answered, and `N of M yr` when they did not.
 *
 * **A partial window must not wear the whole window's tag.** `avg2` over a
 * season with target share and a season without is one observation, and
 * printing `2 yr` over it says the average is twice as well founded as it is.
 * A collapsed window — a rookie's two-year read — says `1 yr` rather than
 * `1 of 1 yr`, because nothing was missing: the series is the limit, and that
 * is a fact about the player rather than a gap in the data.
 *
 * An unreadable pair (`used` null or zero) has no tag to print; the chip draws
 * an em dash there and no bars, which is the distance's own rule made visible.
 */
export function observationTag(
  windowed: boolean,
  window: CompWindowId,
  reading: { used: number | null; of: number },
  tag: string,
): string {
  if (!windowed) return "";
  const { used, of } = reading;
  if (used === null || used === 0) return "";
  if (used < of) return `${used} of ${of} yr`;
  if (window !== "last" && of === 1) return "1 yr";
  return tag;
}
