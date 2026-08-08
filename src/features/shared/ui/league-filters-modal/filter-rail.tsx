import { useMemo } from "react";

import { type LeagueFilters, matchesFilters } from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

import { CAPTION } from "./league-filters-modal.constants.ts";

/**
 * One fixed filter, as a row of keys with every option's count on it.
 *
 * It was a collapsed row whose options floated over the panel, and the collapse
 * was itself a correction: three captions and thirteen keys stacked as three
 * sections was ~290px of a 700px phone, and the rule bays — the part of the
 * dialog that can't be asked any other way — fell below the fold. What that got
 * wrong was the *layout*, not the control. A caption and its options on one line
 * is **shorter than the collapsed row** on a laptop (a row and its summary
 * against a row), and it puts back the thing the collapse cost: the counts.
 *
 * The counts are the dialog's whole argument over the always-visible bar this
 * replaced — "is it worth narrowing to dynasty" answered before the list moves.
 * Behind a press they were three of thirteen, and comparing two of them meant
 * two presses and two panels that could not be on screen together. Every `probe`
 * closes over the draft, so a rail is a **live cross-tab** rather than a menu:
 * lighting Dynasty moves the Format row's numbers underneath it.
 *
 * On a phone the keys wrap after the caption and nothing else about the row
 * changes. That is deliberate and is the reason this is not a collapsed row down
 * there: one list must not be two controls either side of a breakpoint — the
 * mistake the league cards' own per-card column labels were removed for. What
 * legitimately changes at a width is geometry.
 *
 * Four behaviours went with the popover and are owed by nothing now: the
 * one-open-at-a-time state, the outside-press dismissal, the `preventDefault` on
 * the dialog's `cancel` that stopped Escape closing everything at once, and the
 * focus return.
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
  leagues: readonly ManagerLeague[];
  /**
   * This selection with one option substituted, for the per-option counts.
   *
   * **Optional, because not every row here narrows leagues.** The fixed filters
   * do, and the count is what makes the dialog worth the press; the ADP board
   * seats a row for the *kind of draft* it averages, which cuts drafts within a
   * league rather than leagues — so every option would carry the identical
   * league count, which is a number that looks like an answer and is about
   * something else. A row with no probe draws no counts.
   */
  probe?: (value: T) => LeagueFilters;
  onPick: (value: T) => void;
}) {
  const counts = useMemo(
    () =>
      probe
        ? options.map(
            (option) =>
              leagues.filter((league) =>
                matchesFilters(league, probe(option.value)),
              ).length,
          )
        : null,
    // `probe` closes over the draft, so it is the dependency that matters.
    [options, leagues, probe],
  );

  return (
    // `group` rather than `radiogroup`: these are `aria-pressed` toggles, and a
    // radio group would promise arrow-key roving that the row does not do.
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-1.5"
    >
      {/* Fixed rather than intrinsic, so the four captions share a left edge and
          the keys start at one x down the trough — a ragged left is what makes
          a stack of rows read as four unrelated controls. */}
      <span className={`${CAPTION} w-14 shrink-0`}>{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {options.map((option, i) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onPick(option.value)}
              className={`inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                isSelected
                  ? "lab-chip lab-chip-sm lab-chip-on"
                  : "lab-chip lab-chip-sm text-foreground/70 hover:text-foreground"
              }`}
            >
              {option.label}
              {counts && (
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    isSelected ? "text-[#052029]/60" : "text-foreground/40"
                  }`}
                >
                  {counts[i]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
