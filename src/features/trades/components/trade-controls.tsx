"use client";

import { useId } from "react";

import { filterSummary } from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_TRADE_FILTERS,
  TRADE_CIRCLES,
  activeTradeFilterCount,
  circleIndex,
  stepCircle,
  tradeFilterSummary,
} from "../filters";
import type { TradeCircle, TradeFilters, TradeNames } from "../filters";

/**
 * The trades board's own controls, seated on the page: where the reader is
 * standing, and what the board came out as.
 *
 * **It replaces a ledge that expanded onto a panel, and the panel is gone
 * rather than moved.** That control put the scope behind a press, on the
 * reasoning that a scope is chosen once and then read — an argument that is
 * right about *reading* it and wrong about the press. The scope is the page's
 * single most consequential narrowing (it is the difference between the whole
 * crawled market and one account's corner of it), and it was invisible until
 * opened, so the ledge had to carry a summary line restating it — the summary
 * doing the work of the control it was hiding.
 *
 * **The seek left this block too, and in the other direction.** It was a labelled
 * date field on the row below the scope, which is the right seat for a setting
 * and the wrong one for a *position*: the board is a hundred thousand rows deep
 * and the one moment a reader wants to travel is the moment this block is three
 * screens up. It is a pinned key over the board now ({@link SeekKey}), rendered
 * by `TradesHome` — so what is left here is genuinely only the two things chosen
 * once and then read.
 *
 * Two rows, and the split is what each row is *for* rather than a way to fit:
 *
 * - **The scope leads**, because it says what board this is. Nothing about the
 *   list can be read without knowing which population it came from. From `sm`
 *   the sentence explaining the circle shares that row rather than taking one.
 * - **What the board came out as follows** — the scope in words, the count, and
 *   the two triggers the page keeps behind a press (its value column and the
 *   league rules). This is the old ledge's row with its own trigger removed.
 *
 * The whole thing sits inside the element the virtualizer watches, so a row
 * wrapping at a narrow width moves the list down the page and the list is told.
 * Nothing here expands, which is what retired the `dynamic()` the ledge needed:
 * what is left is one stepper and two lines of prose, and a split costs more
 * than it saves at that size.
 */
export function TradeControls({
  filters,
  onChange,
  leagueFilters,
  season,
  account,
  names,
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
  /** The page's own controls, seated on the summary row. */
  trailing?: React.ReactNode;
}) {
  // The sentence under the instrument is what says *why* a step key is inert
  // without an account, so the keys point at it rather than leaving the
  // explanation beside them and unrelated.
  const circleNoteId = useId();
  const active = activeTradeFilterCount(filters);
  const selection = tradeFilterSummary(filters, names);

  return (
    <div className="lab-trough mb-4 flex flex-col gap-2.5 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* The population, leading, because it is the widest claim on the page:
            every other control here narrows within whatever this leaves. */}
        <CircleAperture
          circle={filters.circle}
          hasAccount={account !== null}
          describedBy={circleNoteId}
          onChange={(circle) => onChange({ ...filters, circle })}
        />

        {/* What the circle means, in one line. It takes a line of its own below
            `sm` and shares the instrument's row above it — the same shape the
            summary row below uses, and for the same reason: on a phone a
            sentence beside a control is two truncated things rather than one
            legible one.

            Unlike the four keys this replaced, it is never silent. Those keys
            printed the circle's full name, so a note under them repeated it;
            the readout has room for the name and not for what the name means,
            which is exactly the half a sentence is for. */}
        <p
          id={circleNoteId}
          className="order-last min-w-0 basis-full text-xs text-foreground/45 sm:order-none sm:basis-auto sm:flex-1"
        >
          {circleNote(filters.circle, account)}
        </p>
      </div>

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
 * How far out to draw the circle: a readout with a step either side.
 *
 * **The circles are a radius, and this is the control that says so.** They nest
 * — `mine ⊆ leaguemates ⊆ leaguemate-leagues ⊆ all` — so what a reader is
 * choosing is not one of four unrelated answers but *how far out* to draw one
 * circle. Four keys of equal weight said the opposite, in an order (widest,
 * then narrowest, then two middles) that no reading of the row could decode;
 * `‹` and `›` are the two presses the question actually has, and the four pips
 * are where along it you are standing.
 *
 * Four decisions in it:
 *
 * - **It is an instrument, not a field.** The accent rail is the manager
 *   plate's mark for "a readout follows" and the name is engraved into a
 *   `.lab-readout` cut rather than lit on a face — the raised/recessed grammar
 *   the rest of the app keeps, where what you press is raised (the two step
 *   keys) and what you read is sunk.
 * - **It cannot wrap at any width.** One row of a fixed height, which is the
 *   property the four keys did not have: at 390px they took two lines, and the
 *   block above a windowed list is height charged to every card on screen.
 * - **A step with nowhere to go is drawn inert rather than hidden**, and it is
 *   `aria-disabled` rather than `disabled` — the reason a key is dead is a
 *   sentence printed under it, and `disabled` takes the key out of the tab order
 *   and that sentence out of reach with it. This is the same call the four keys
 *   made for the same reason.
 * - **The name is a live region.** The step keys are labelled "narrower" and
 *   "wider", which is what they *do* and not what the board became — so the one
 *   thing a press changes has to announce itself, or the control is only legible
 *   to someone who can see the readout.
 *
 * What it costs is spelled out where the decision was made: up to three presses
 * to reach a named circle, where four keys were always one. The trade is that
 * the four keys were also always four keys, in an arbitrary order, wrapping.
 */
function CircleAperture({
  circle,
  hasAccount,
  describedBy,
  onChange,
}: {
  circle: TradeCircle;
  /** Every circle but the widest is drawn around an account — see {@link stepCircle}. */
  hasAccount: boolean;
  /** The sentence saying what this circle is, and why a step may be inert. */
  describedBy: string;
  onChange: (circle: TradeCircle) => void;
}) {
  const at = circleIndex(circle);
  const label = TRADE_CIRCLES[at].label;

  return (
    <div
      role="group"
      aria-label="Scope"
      // **A fixed width from `sm`, not a share of the row**, and the difference
      // is the whole legibility of the part. As `flex-1` beside the sentence it
      // sat next to, the readout resized with *that sentence's* length —
      // `LEAGUEMATE TRADES` came out as `LEAGU…` under the longest note and full
      // width under the shortest, so the one thing the instrument exists to say
      // was the first thing to go. (Tailwind emits `basis-auto` after `flex-1`,
      // so the sentence's `sm:basis-auto sm:flex-1` is `flex: 1 1 auto` —
      // content-sized *and* growing, which takes the slack from anything else
      // sharing the row.) 19rem holds the longest circle name at this face
      // without truncating; the sentence takes whatever is left.
      //
      // Below `sm` it is the row's whole width, which is the same rule read the
      // other way: down there the sentence is on a line of its own, so there is
      // no slack to share and every pixel is the readout's.
      className="flex w-full items-center gap-2 sm:w-[19rem] sm:flex-none"
    >
      <StepKey
        to={stepCircle(circle, -1, hasAccount)}
        label="Narrow the scope"
        describedBy={describedBy}
        onChange={onChange}
      >
        ‹
      </StepKey>

      <span className="lab-readout flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-2.5">
        {/* Flush to the readout's leading edge and stretched to its height: it
            is the side of the part catching the light, the same rail the ADP
            block wears, rather than a stripe drawn on the face. */}
        <span
          aria-hidden
          className="lab-billet-rail w-[2.5px] flex-none self-stretch rounded-[2px]"
        />
        <span
          // The only thing a press changes, and the step keys' own labels
          // cannot say it — so it says itself.
          aria-live="polite"
          className="lab-engraved min-w-0 flex-1 truncate font-display text-[11.5px] font-semibold uppercase tracking-[0.03em] text-foreground/90"
        >
          {label}
        </span>
        <Pips at={at} />
      </span>

      <StepKey
        to={stepCircle(circle, 1, hasAccount)}
        label="Widen the scope"
        describedBy={describedBy}
        onChange={onChange}
      >
        ›
      </StepKey>
    </div>
  );
}

/**
 * One notch in or out — or the inert spelling of it, where `to` is null.
 *
 * Flat and unlit when there is nowhere to go: the app bar's rule held to at this
 * size, that a part which does nothing when pressed must not look pressable, so
 * it loses its wall rather than only dimming its glyph.
 */
function StepKey({
  to,
  label,
  describedBy,
  onChange,
  children,
}: {
  /** Where this key goes, or null when the ladder ends here. */
  to: TradeCircle | null;
  label: string;
  describedBy: string;
  onChange: (circle: TradeCircle) => void;
  children: React.ReactNode;
}) {
  const dead = to === null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={dead || undefined}
      aria-describedby={dead ? describedBy : undefined}
      onClick={() => {
        if (to === null) return;
        onChange(to);
      }}
      className={`grid h-[30px] w-[26px] flex-none place-items-center rounded-lg text-[13px] leading-none ${
        dead
          ? "cursor-not-allowed text-foreground/25"
          : "lab-chip lab-chip-sm text-foreground/75"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Where along the radius the board is standing, as four dots.
 *
 * Decorative and `aria-hidden`: it says the same thing as the readout beside it
 * and the position within the ladder, both of which are already announced. What
 * it adds for a reader who can see it is that there *is* an ordering — which is
 * the whole complaint against the keys this control replaced.
 */
function Pips({ at }: { at: number }) {
  return (
    <span aria-hidden className="flex flex-none items-center gap-1">
      {TRADE_CIRCLES.map((option, index) => (
        <span
          key={option.value}
          className={`block h-[5px] w-[5px] rounded-full ${
            index === at
              ? "bg-active shadow-[0_0_6px_rgba(0,255,229,0.85)]"
              : "bg-foreground/20"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * What the scope instrument is showing, in one line.
 *
 * **It always speaks**, which is the change the readout forced. The four keys it
 * replaced printed each circle's full name, so a note repeating the selected one
 * was the restatement a control on the page exists to retire — hence the old
 * `circle === "all" → null`. A readout has room for the name and not for what
 * the name means, and the two leaguemate readings are indistinguishable by name
 * alone: who was *dealing* against where the deal *happened*.
 *
 * Two things it says that the instrument cannot. What this circle is, and — once
 * one is chosen — *whose* it is: the account is stored on the device and may not
 * be the one the reader has in mind.
 *
 * Without an account the sentence carries the way out, because that is what the
 * inert step keys point at. It leads with the circle either way, so the line
 * describes the board in front of the reader before it asks anything of them.
 */
function circleNote(circle: TradeCircle, account: UserInfo | null): string {
  const { note } = TRADE_CIRCLES.find((c) => c.value === circle)!;
  if (account === null) {
    return `${note} Look your Sleeper account up on the tools page to narrow to your own leagues and leaguemates.`;
  }
  if (circle === "all") return note;
  return `${note} Drawn around @${account.display_name || account.username}.`;
}
