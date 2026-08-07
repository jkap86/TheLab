"use client";

import { useId } from "react";

import { filterSummary } from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_TRADE_FILTERS,
  TRADE_CIRCLES,
  activeTradeFilterCount,
  tradeFilterSummary,
} from "../filters";
import type { TradeCircle, TradeFilters, TradeNames, TradeSeek } from "../filters";

/**
 * The trades board's own controls, seated on the page: where the reader is
 * standing, and where in the board they are standing.
 *
 * **It replaces a ledge that expanded onto a panel, and the panel is gone
 * rather than moved.** That control put the two things it holds behind a press,
 * on the reasoning that a scope and a window are chosen once and then read — an
 * argument that is right about *reading* them and wrong about the press. The
 * scope is the page's single most consequential narrowing (it is the difference
 * between the whole crawled market and one account's corner of it) and the seek
 * is a place in the list, which is not a setting at all; both were invisible
 * until opened, so the ledge had to carry a summary line restating them, and the
 * summary was doing the work of the control it was hiding. On the page they
 * state themselves — a lit key and a date field — and the summary drops to the
 * one thing still behind a press.
 *
 * Two rows, and the split is what each row is *for* rather than a way to fit:
 *
 * - **The controls that moved out lead**, because between them they say what
 *   board this is. Nothing about the list can be read without knowing which
 *   population it came from.
 * - **What the board came out as follows** — the scope in words, the count, and
 *   the two triggers the page keeps behind a press (its value column and the
 *   league rules). This is the old ledge's row with its own trigger removed.
 *
 * The whole thing sits inside the element the virtualizer watches, so a row
 * wrapping at a narrow width moves the list down the page and the list is told.
 * Nothing here expands, which is what retired the `dynamic()` the ledge needed:
 * what is left is four keys, a date input and two lines of prose, and a split
 * costs more than it saves at that size.
 */
export function TradeControls({
  filters,
  onChange,
  leagueFilters,
  season,
  account,
  names,
  today,
  trailing,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  /** Only to spell the scope out — this control does not edit them. */
  leagueFilters: LeagueFilters;
  season: string;
  /** The reader's stored account, or null — what the circle is drawn around. */
  account: UserInfo | null;
  /**
   * How to name what the bays hold. The summary reads the selection out rather
   * than counting it, which is what the sides bought — and this control holds no
   * ids of its own, so the page's own lookups come in.
   */
  names: TradeNames;
  /** Today where the reader is, `YYYY-MM-DD` — see {@link SeekField}. */
  today: string;
  /** The page's own controls, seated on the summary row. */
  trailing?: React.ReactNode;
}) {
  // The caption under the scope keys is what says *why* they are inert without
  // an account, so the keys point at it rather than leaving the sentence beside
  // them and unrelated.
  const circleNoteId = useId();
  const active = activeTradeFilterCount(filters);
  const note = circleNote(filters.circle, account);
  const selection = tradeFilterSummary(filters, names);

  return (
    <div className="lab-trough mb-4 flex flex-col gap-2.5 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* The population, leading, because it is the widest claim on the page:
            every other control here narrows within whatever this leaves. */}
        <div
          role="group"
          aria-label="Scope"
          className="flex flex-wrap items-center gap-1.5"
        >
          {TRADE_CIRCLES.map((option) => (
            <Key
              key={option.value}
              selected={filters.circle === option.value}
              // Every circle but the widest is drawn around an account, so
              // without one there is nothing to draw. Disabled rather than
              // absent: what it takes to switch it on is a sentence, and hiding
              // the control hides the sentence too — which is also why it is
              // `aria-disabled`, so the key stays reachable and carries the
              // sentence with it.
              disabled={option.value !== "all" && account === null}
              describedBy={circleNoteId}
              onClick={() => onChange({ ...filters, circle: option.value })}
            >
              {option.label}
            </Key>
          ))}
        </div>

        {/* A cut rather than air, because this row wraps: spacing does not
            survive a wrap, and the two groups are different questions — which
            trades are on this board, and where in it to start reading. The
            manager tool's subject rail parts its own groups the same way. */}
        <span
          aria-hidden="true"
          className="hidden h-3.5 w-px shrink-0 bg-[rgba(0,0,0,0.5)] shadow-[1px_0_0_rgba(255,255,255,0.09)] sm:block"
        />

        <SeekField
          value={filters.seek}
          today={today}
          onChange={(seek) => onChange({ ...filters, seek })}
        />
      </div>

      {/* One caption for the group rather than a note under each key: the labels
          alone don't separate the two leaguemate readings — one is about who was
          dealing, the other about where the deal happened — and four notes at
          this width is a paragraph where the row should be.

          Drawn only when it says something the keys don't. With an account and
          the widest circle there is nothing left to explain, and a line
          permanently reading "the whole crawled market" under a lit key spelling
          "Every league" is the restatement this whole change is about. */}
      {note !== null && (
        <p id={circleNoteId} className="text-xs text-foreground/45">
          {note}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* What the board came out as, in words. It takes a line of its own
            below `sm` rather than sharing this one: sharing, it was the part
            that gave way, and a phone left it `202…` — which is a badge with
            none of the sentence's meaning. From `sm` it goes back inline and
            takes the slack, so the triggers stay right-aligned. */}
        <p className="order-last min-w-0 basis-full truncate text-xs text-foreground/50 sm:order-none sm:basis-auto sm:flex-1">
          {season} · {filterSummary(leagueFilters)}
          {selection === null ? "" : ` · ${selection}`}
        </p>

        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_TRADE_FILTERS)}
            className="shrink-0 text-xs font-semibold text-foreground/45 transition-colors hover:text-foreground"
          >
            Clear
          </button>
        )}

        {trailing}
      </div>
    </div>
  );
}

/**
 * Where in the board to start reading: one date, defaulting to today.
 *
 * **It is a position, not a window, and every decision here follows from that.**
 * The board is a keyset walk newest-first, so a date is a place to resume it and
 * everything older stays below — which is why there is one field where there
 * were two, no preset table, and nothing to leave half-filled. The page scrolls
 * the list back to its top when this moves, which is what makes it read as
 * travelling to the date rather than as slicing the board at it.
 *
 * Three details are load-bearing:
 *
 * - **It shows today while holding null.** The default is "the newest trades",
 *   which is not a date — but an empty date field says nothing and invites a
 *   press to find out, where today's date says exactly where the board is.
 *   `tradeSeekBounds` folds the two together so neither spelling costs a second
 *   cache entry.
 * - **Picking today, or clearing the field, is the way back.** A reader who
 *   travelled back has the newest trades one press away without reaching for
 *   `Clear`, which would take their circle and their search with it.
 * - **`max` is today**, because there is nothing to seek to in the future and a
 *   calendar that opens on a month with no trades in it is a dead end.
 *
 * A native input, so the platform's calendar, its keyboard entry and its locale
 * spelling all come free — the same call the two date fields it replaces made.
 */
function SeekField({
  value,
  today,
  onChange,
}: {
  value: TradeSeek;
  /** Today where the reader is — passed in rather than read from the clock, so this renders the same on every re-render of the day. */
  today: string;
  onChange: (seek: TradeSeek) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        id={labelId}
        className="text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/40"
      >
        Jump to
      </span>
      <input
        type="date"
        aria-labelledby={labelId}
        value={value ?? today}
        max={today}
        onChange={(event) => {
          const picked = event.target.value;
          // An emptied field and today are both "the newest trades" — see the
          // note above. Anything past today would bound nothing anyway, so it
          // is folded here rather than left for the resolver to discover.
          onChange(!picked || picked >= today ? null : picked);
        }}
        className="rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-active/45"
      />
      {value !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="lab-chip lab-chip-sm shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-foreground/75"
        >
          Today
        </button>
      )}
    </div>
  );
}

/**
 * A segment key on the controls row — `.lab-chip-sm`, the app's thinner press.
 *
 * Thinner than the page's own triggers for the reason the league filters'
 * quick-adds are: a key that sets one value among four is a lesser press than a
 * key that opens a dialog, and a row of full-thickness parts here would read as
 * competing with the two beside them.
 */
function Key({
  selected,
  disabled = false,
  describedBy,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  /** The note saying why this key is inert, where it is. */
  describedBy?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      // `aria-disabled`, not `disabled`. The reason these are inert is a
      // sentence printed under them, and `disabled` takes the key out of the tab
      // order and the sentence out of reach with it — a filter nobody can find
      // is one nobody knows they could have, which is the argument that kept the
      // keys visible in the first place.
      aria-disabled={disabled || undefined}
      aria-describedby={disabled ? describedBy : undefined}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        selected
          ? "lab-chip-on lab-chip-sm"
          : disabled
            ? // Flat and unlit, the app bar's rule held to at this size: a part
              // that does nothing when pressed must not look pressable, so it
              // loses its wall rather than only dimming its text.
              "cursor-not-allowed rounded-full text-foreground/25"
            : "lab-chip lab-chip-sm text-foreground/75"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * What the scope keys mean, in one line that follows the selection — or null
 * where the keys have already said it.
 *
 * Two things it says that the keys cannot. Which of the two leaguemate circles
 * is which — who was *dealing* against where the deal *happened* — and, once one
 * is chosen, *whose* circle it is: the account is stored on the device and may
 * not be the one the reader has in mind.
 *
 * With an account and the widest circle it says neither, so it says nothing.
 * Without one it always speaks, because that is the sentence the inert keys
 * point at.
 */
function circleNote(circle: TradeCircle, account: UserInfo | null): string | null {
  if (account === null) {
    return "Look your Sleeper account up on the tools page to filter by your own leagues and leaguemates.";
  }
  if (circle === "all") return null;
  const who = `@${account.display_name || account.username}`;
  const note = TRADE_CIRCLES.find((c) => c.value === circle)!.note;
  return `${note} Drawn around ${who}.`;
}
