import { useId, useMemo, useRef } from "react";

import { type LeagueFilters, matchesFilters } from "../../league-filters";
import { useReturnFocus } from "../../use-return-focus";
import type { ManagerLeague } from "@/shared/manager";

import { CAPTION } from "./league-filters-modal.constants.ts";
import { selectedSegment } from "./league-filters-modal.utils.ts";

/**
 * One fixed filter, as a collapsed row whose options open over the panel.
 *
 * The three groups used to be three captions and thirteen keys, permanently on
 * screen. At the width that matters — a phone, where the trough's grid drops to
 * one column and every caption takes a row of its own — that was ~290px of a
 * 700px screen spent on what is usually one selection, and the rule bays, which
 * are the part of the dialog that can't be asked any other way, fell below the
 * fold. Collapsed, the same three filters are three lines: the caption, the
 * selection stated in the words the trigger and the header already use, and the
 * count behind it.
 *
 * **The options float; they do not expand into the layout.** A row that pushed
 * the rule bays further down as it opened would be reintroducing the problem one
 * group at a time — and the reader who opens Status is looking at Status, so the
 * panel is free to cover what is underneath it. It is a raised face over the
 * recessed trough, which is the same material grammar as everything else here:
 * the thing you are working in sits above the thing you are working on.
 *
 * The count is what makes the dialog worth the click over the old bar: it is the
 * answer to "is it worth narrowing to this" before the list moves. It's probed
 * against the rest of the *draft*, so the numbers describe the selection being
 * built rather than each filter in isolation — which is why the collapsed row
 * can carry the current option's count without computing anything of its own.
 */
export function SegmentRow<T extends string>({
  label,
  options,
  value,
  leagues,
  probe,
  onPick,
  open,
  onToggle,
  onClose,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  leagues: readonly ManagerLeague[];
  /**
   * This selection with one option substituted, for the per-option counts.
   *
   * **Optional, because not every row here narrows leagues.** The three fixed
   * filters do, and the count is what makes the dialog worth the press; the ADP
   * board seats a fourth row for the *kind of draft* it averages, which cuts
   * drafts within a league rather than leagues — so every option would carry the
   * identical league count, which is a number that looks like an answer and is
   * about something else. A row with no probe draws no counts.
   */
  probe?: (value: T) => LeagueFilters;
  onPick: (value: T) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popId = useId();
  // Escape is the dialog's `cancel`, which closes this row from the outside — so
  // a reader who had tabbed onto one of the options loses it out from under them
  // and lands on `body`.
  useReturnFocus(open, trigger);

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

  const { index: selectedIndex, selected, narrowed } = selectedSegment(
    options,
    value,
  );

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        // No `aria-haspopup`: what opens is a list of radio-ish keys, not a
        // menu, and `expanded` plus `controls` is the disclosure this actually
        // is. The name is left to come from the row's own contents — caption,
        // selection and count — which is the whole of what it says.
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
          open ? "bg-foreground/[0.07]" : "hover:bg-foreground/5"
        }`}
      >
        <span className={CAPTION}>{label}</span>
        <span
          className={`ml-auto truncate text-[13px] font-bold ${
            narrowed ? "text-active" : "text-foreground/80"
          }`}
        >
          {selected?.label}
        </span>
        {counts && (
          <span className="font-mono text-[10px] tabular-nums text-foreground/35">
            {counts[selectedIndex]}
          </span>
        )}
        <Caret open={open} />
      </button>

      {open && (
        <div
          id={popId}
          role="group"
          aria-label={label}
          // `top-full` rather than a computed offset: the panel hangs off the
          // row it belongs to, and the trough is at the top of a scroll box tall
          // enough to hold it.
          className="filters-segment-pop absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-active/25 bg-gradient-to-b from-[#1b3040] to-[#0d1c27] p-2 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.95),0_0_36px_-16px_rgba(0,255,229,0.35)]"
          style={{ animation: "dialog-rise 0.14s cubic-bezier(0.2,0.9,0.3,1)" }}
        >
          {/*
            One option per line, not a wrapping row of chips. Wrapped, the
            options of a group broke into ragged lines whose length depended on
            how long each label happened to be, so the counts — the number the
            dialog is read for — landed at a different x on every line and there
            was no column to compare them down. Stacked, the labels share a left
            edge and the counts share a right one, which is what makes "84 in
            season against 28 pre-draft" readable at a glance.
          */}
          <div className="flex flex-col gap-1">
            {options.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={isSelected}
                  // Picking is the row's whole job, so it closes behind you —
                  // one selection per group means there is nothing left to do
                  // in an open panel.
                  onClick={() => {
                    onPick(option.value);
                    onClose();
                  }}
                  className={`flex w-full items-baseline gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-bold ${
                    isSelected
                      ? "lab-chip-on"
                      : "lab-chip text-foreground/70 hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {counts && (
                    <span
                      className={`ml-auto font-mono text-[10px] tabular-nums ${
                        isSelected ? "text-[#052029]/60" : "text-foreground/35"
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
      )}
    </div>
  );
}

/**
 * The row's disclosure mark, pointing down closed and up open.
 *
 * A rotation rather than two glyphs, so the mark a reader is looking at is the
 * one that moves.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`h-3 w-3 shrink-0 text-foreground/40 transition-transform duration-150 ${
        open ? "-rotate-180" : ""
      }`}
    >
      <path
        d="M3 4.5 6 8l3-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
