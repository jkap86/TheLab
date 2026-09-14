"use client";

import { useMemo } from "react";

import type { ManagerLeague } from "@/shared/contract";
import { type LeagueFilters, matchesFilters } from "../league-filters";

import { SwitchTrack } from "../ui/ktc-board-keys";

/**
 * One fixed filter: a labelled track of option keys, each carrying what picking
 * it would leave.
 *
 * **The counts are a cross-tab, not a tally.** `probe` closes over the whole
 * draft and substitutes one field, so each number says what *this* selection
 * with that option would leave — the question the dialog is opened to answer.
 * Lighting Dynasty therefore moves the Format row's numbers underneath it,
 * which a per-filter-in-isolation count could not show.
 *
 * **It is a `SwitchTrack`, where it used to be a row of keys written here.**
 * The two are the same control — one detent lit, the rest flush, in a channel —
 * and a switch that stopped travelling in one of two spellings is the failure
 * `console-chrome`'s constants exist to prevent. What the rails needed that the
 * track did not have is the count, which is {@link SwitchTrack.badge}: a slot
 * inside the key, so it inherits the lit ink rather than being a second element
 * standing beside one.
 *
 * Generic over the option value so the two rails keep their own unions: a
 * `LeagueFilters["type"]` cannot be handed to the Format row by mistake.
 */
export function FilterRail<T extends string>({
  label,
  options,
  value,
  leagues,
  probe,
  onPick,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  /** The unfiltered list the counts are taken over. */
  leagues: readonly ManagerLeague[];
  /** The draft with this row's field set to the option under the cursor. */
  probe: (value: T) => LeagueFilters;
  onPick: (value: T) => void;
}) {
  const counts = useMemo(
    () =>
      new Map(
        options.map((option) => [
          option.value,
          leagues.filter((league) =>
            matchesFilters(league, probe(option.value)),
          ).length,
        ]),
      ),
    [options, leagues, probe],
  );

  const values = useMemo(
    () => options.map((option) => option.value),
    [options],
  );

  /**
   * The track's own vocabulary, which is the shipped labels with one shortened.
   *
   * **The neutral option is `All`, not `All types` / `All formats`**, and that
   * is a fact about where it is drawn rather than a second name for it. A
   * `SwitchTrack`'s keys are `flex-1` from `sm` up, so five keys carrying counts
   * share the track equally and the longest legend is what clips; and the axis
   * this option is neutral *on* is named by the legend three characters to its
   * left, so the full label is the one thing on the row that says something
   * twice. The shipped labels are untouched, because they have three other
   * readers — the summary sentence, the trigger's count and the config window —
   * where there is no legend beside them and the noun is the whole reading.
   *
   * `all` is the neutral value on both fixed fields by construction; see
   * `FIXED_FILTERS`, which walks the two of them generically for that reason.
   */
  const labels = useMemo(
    () =>
      Object.fromEntries(
        options.map((option) => [
          option.value,
          option.value === "all" ? "All" : option.label,
        ]),
      ) as Record<T, string>,
    [options],
  );

  return (
    <SwitchTrack
      label={label}
      legend
      options={values}
      value={value}
      onChange={onPick}
      labels={labels}
      className=""
      size="row"
      /**
       * An option this selection leaves nothing on cannot be pressed, and the
       * title says so in the cross-tab's own terms rather than the option's.
       *
       * The distinction is the whole reason the wording is not "no league in
       * hand is chopped": the number is what picking it *with the rest of the
       * draft* would leave, so a zero on `Chopped` beside a `teams = 12` rule
       * means there is no twelve-team chopped league, not that the account
       * holds no chopped one. A title that named the option alone would be a
       * claim about the data made by a number that is about the selection.
       *
       * `SwitchTrack` skips this for the lit key on a single-select track,
       * which is what keeps the current option pressable when a rule has
       * narrowed it to nothing — the one press that would undo the narrowing is
       * never the one taken away.
       */
      unavailable={(option) =>
        counts.get(option) === 0
          ? `${labels[option]} leaves nothing on this selection`
          : null
      }
      badge={(option) => (
        // Inside the key, so it takes the key's own ink with the label rather
        // than being held apart from it — lit at full opacity, because light
        // mode's teal is only ~5:1 against the page and an alpha on it drops
        // below AA, and dimmed with the key where the key is dim. Size is what
        // separates the count from the name, on all three.
        <span
          className={`ml-1.5 font-mono text-[length:var(--fs-8-5)] tabular-nums ${
            option === value || counts.get(option) === 0
              ? ""
              : "text-foreground/40"
          }`}
        >
          {counts.get(option)}
        </span>
      )}
      /**
       * The keys size to their own labels and break onto a second line rather
       * than sharing the track equally, which is what five of them carrying
       * counts need at a phone's width.
       *
       * An equal share is `flex-1`, a basis of zero: at 390 the Type track is
       * ~292px, so five keys would take ~58px each against the ~62 `REDRAFT`
       * and its count set at — every key truncated, on a rail whose whole
       * reading is which option and how many. `flex-auto` sizes each to its
       * label and grows it into what is left, and the line breaks where the
       * labels genuinely run out of room. It cannot fluctuate under a press:
       * the vocabulary is a prop and the counts change no label's width by
       * more than a digit.
       */
      wrap
    />
  );
}
