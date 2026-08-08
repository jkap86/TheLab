"use client";

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
 * The sentence saying what the circle on screen is, which the rail's step keys
 * point at through `aria-describedby`.
 *
 * **A constant rather than `useId`, because the reference crosses a component
 * boundary.** The sentence is on the plate and the keys are in the rail — two
 * siblings with no shared ancestor to thread an id through — and there is
 * exactly one of each on the page, so a fixed string cannot collide. `useId`
 * would only be needed if the pair could be drawn twice.
 */
export const CIRCLE_NOTE_ID = "trades-circle-note";

/**
 * What board this is, in words: the circle's name, what that circle means, and
 * everything else narrowing the list.
 *
 * **It is the half of the old controls block that is read once**, and that is
 * the whole of why it was split from {@link TradeControls}. Identity is answered
 * at the top of the page and then never asked again; the controls are reached
 * for at row nine hundred. One block held both, so either the description was
 * paid for permanently or the controls were three screens up — which is the
 * trade the split stops making.
 *
 * It scrolls away, deliberately. Nothing here changes what the board *is* once
 * the reader has read it, and the one number a press moves — the count — is in
 * the rail below, beside the presses that move it.
 *
 * Two lines, and only two:
 *
 * - **The circle's name**, on the display face. It is also in the rail's
 *   readout, which is the accepted cost of pinning that control: a rail that
 *   outlives this plate has to say what it is set to, or a reader who scrolled
 *   past has an instrument with no label. Two spellings of one fact, on purpose,
 *   only one of which is ever alone on screen.
 * - **What that circle means**, which the readout has no room for and which is
 *   the only thing separating the two leaguemate readings — who was *dealing*
 *   against where the deal *happened*. It carries {@link CIRCLE_NOTE_ID},
 *   because it is also what says why a step key is inert without an account.
 *
 * **What is deliberately not here is the season, the league rules and the search
 * selection**, which are on the rail. They look like description and belong with
 * the plate on that reading, but they are the one part of the description a
 * press *moves* — pressing Leagues changes them — and feedback for a control has
 * to be where the control is. This plate says what the board is; the rail says
 * what is currently narrowing it.
 */
export function TradeIdentity({
  filters,
  account,
}: {
  filters: TradeFilters;
  /** The reader's stored account, or null — what the circle is drawn around. */
  account: UserInfo | null;
}) {
  return (
    // A plate rather than the trough this replaced. Every object on this page is
    // machined — the cards are slabs wearing nameplates, the rail below is a
    // billet — and a recess is the one face in the vocabulary that means "a
    // thing is seated here", which is what made the old block read as leftover
    // chrome above the product rather than as its description.
    <div className="lab-plate relative mb-3 overflow-hidden rounded-2xl px-4 py-3 pl-5">
      {/* The lit leading edge: the manager plate's mark for "a readout
          follows". Flush to the edge and stretched, so it is the side of the
          part catching the light rather than a stripe drawn on its face. */}
      <span
        aria-hidden
        className="lab-billet-rail absolute inset-y-0 left-0 w-[3px]"
      />

      <p className="font-display text-[15px] font-semibold tracking-[0.02em] text-foreground">
        {TRADE_CIRCLES[circleIndex(filters.circle)].label}
      </p>
      <p id={CIRCLE_NOTE_ID} className="mt-1 text-xs text-foreground/50">
        {circleNote(filters.circle, account)}
      </p>
    </div>
  );
}

/**
 * The board's controls, on one band pinned under the app bar.
 *
 * **Everything a reader reaches for while reading is here, and nothing else
 * is.** How far out the circle is drawn, how big the board came out, which value
 * the cards price, which leagues are in it, and where in it the reader is
 * standing — one row, always on screen. What is *not* here is the description of
 * any of it, which is {@link TradeIdentity} and scrolls away.
 *
 * **It absorbed the seek key, and that is what made pinning it possible at
 * all.** The key was already pinned, at `--site-header-h + 0.5rem`, right-
 * aligned, `z-30` — exactly the band and the edge a rail modelled on
 * `ListLedge` wants. Two pinned parts in one band is not a layering problem to
 * be solved with a bigger `z-index`, it is two answers to "what does this page
 * keep on screen", so the key became this rail's trailing member. Two things
 * follow from the move rather than being paid for it: the board covers one band
 * instead of two, and the key's date plate finally rides an edge that is always
 * there — floating, it rose out of a 40px key and landed over whichever card the
 * scroll had put beneath it, where here it labels the rail, which is exactly
 * what a date on this page is a fact about.
 *
 * Four things about the seat are load-bearing:
 *
 * - **The sticky wrapper cannot be a child of the header block.** A sticky
 *   element travels only as far as its own parent's box, and a rail seated
 *   inside the block above the list would unpin the moment that block scrolled
 *   off — the trap `ListLedge` and the old seek seat each hit once. Its parent
 *   is `PageShell`'s `<main>`, which spans the list.
 * - **It carries no `clip-path`.** `.lab-ledge`'s own notch would sever both the
 *   seek key's plate, which hangs below this rail's bottom edge, and its panel,
 *   which opens beneath it — the trade card's nameplate rule, third instance.
 *   Rounded corners instead.
 * - **`z-30`, under the app bar's `z-50`.** The bar is the one piece of chrome
 *   this page may never cover, and the cards below are static, so nothing else
 *   competes.
 * - **The bottom margin is the plate's overhang plus clearance**, paid as margin
 *   rather than as a negative offset — the trade card's rule for a part rising
 *   out of an edge, and what keeps a travelled board's date off the search bays
 *   beneath it.
 *
 * Nothing here expands, so there is no `dynamic()` to be had: what is left is
 * one stepper, one count and three keys.
 */
export function TradeControls({
  filters,
  onChange,
  leagueFilters,
  season,
  account,
  names,
  seek,
  trailing,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  /** Only to spell the narrowing out — this control does not edit them. */
  leagueFilters: LeagueFilters;
  season: string;
  /** Every circle but the widest is drawn around an account — see {@link stepCircle}. */
  account: UserInfo | null;
  /** How to name what the search bays hold; the page owns the lookups. */
  names: TradeNames;
  /**
   * Where in the board the reader is standing — the rail's own member rather
   * than one of `trailing`, because absorbing it is what let this rail be
   * pinned at all and because its seat differs by width (see below).
   */
  seek?: React.ReactNode;
  /** The page's own controls: the count, the value picker, the league rules. */
  trailing?: React.ReactNode;
}) {
  const active = activeTradeFilterCount(filters);
  const selection = tradeFilterSummary(filters, names);
  const narrowing = `${season} · ${filterSummary(leagueFilters)}${
    selection === null ? "" : ` · ${selection}`
  }`;

  return (
    // The tighter gap below `sm` is worth a utility: at 390px it is the
    // difference between the count and the three keys sharing one line and
    // taking two, on a band that is pinned for the whole of the scroll.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
      <CircleAperture
        circle={filters.circle}
        hasAccount={account !== null}
        onChange={(circle) => onChange({ ...filters, circle })}
      />

      {/* What is narrowing the board, in the row's slack — so the keys stay
          right-aligned and this is what gives way. It truncates rather than
          wraps, because the rail's height is charged to the board for the whole
          of the scroll; the `title` is the desktop backstop the contracted
          player names already use.

          **Dropped below `sm`**, where it is a line of a permanently pinned
          band and the only thing on this rail that is neither a control nor the
          feedback for one — the season and the rules are restated by the dialog
          that sets them, and the search selection by the bays below. `max-sm:`
          rather than `hidden sm:block`, because Tailwind emits the display
          utilities alphabetically and `.hidden` would then win at every width. */}
      <p
        title={narrowing}
        className="min-w-0 flex-1 basis-full truncate text-xs text-foreground/45 max-sm:hidden sm:basis-auto"
      >
        {narrowing}
      </p>

      {trailing}

      {active > 0 && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TRADE_FILTERS)}
          className="shrink-0 text-xs font-semibold text-foreground/55 transition-colors hover:text-foreground"
        >
          Clear
        </button>
      )}

      {/* **Last at every width, and that is the plate's doing rather than a
          preference.** The date rides the rail's *bottom edge*, which is the
          whole gain of folding this key in — and only the row's final member
          has that edge under it. Seated earlier, on a rail that wraps at 390px,
          the plate hangs over the line beneath instead: measured, it landed on
          `Clear`. Sharing the stepper's line would save 40px of permanently
          pinned band on a phone, and it costs the one thing the move was for.

          `ml-auto` so it holds the *trailing* edge of whichever line it lands
          on — on one row the narrowing line's `flex-1` already puts it there,
          and on a wrapped rail it is otherwise left-aligned under the stepper,
          which is not where a reader has learned to reach for it. */}
      <span className="ml-auto flex-none">{seek}</span>
    </div>
  );
}

/**
 * The rail's seat: pinned under the app bar, for the length of the board.
 *
 * Exported so the page can hang its own ref on the same element the rail is —
 * the list watches it for the size changes that move the board down (see
 * `TradesList`), and there is no second box to observe once the rail is a
 * sibling of the header rather than a child of it. It is the *seat and the
 * material together* precisely so it can be one element: this file used to wear
 * it as well, which made the rail two nested copies of itself — double padding,
 * double margin, a 30px dark band under the face and two sticky boxes where the
 * page thought it had one.
 *
 * **`.lab-plate` rather than `.lab-ledge-face`**, which is the other pinned rail
 * in the app and the tempting reuse. That one is a heading rail *over a list of
 * cards*: a bright face carrying engraved labels, tuned to read as a band
 * covering the rows and to set its own `text-shadow` on everything inside it —
 * which on a row of lit chips reads as keys that have already been pressed. This
 * rail holds controls rather than headings, so it takes the app's surface for
 * exactly that (the league panel, the tools menu, this page's own seek panel),
 * with the 4px wall that says raised.
 */
export const TRADE_RAIL_BOX =
  "lab-plate sticky top-[var(--site-header-h)] z-30 mb-5 rounded-xl px-3 py-[6px]";

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
 *   property the four keys did not have: at 390px they took two lines, and this
 *   rail's height is now charged to the board for the whole of the scroll rather
 *   than once at the top.
 * - **A step with nowhere to go is drawn inert rather than hidden**, and it is
 *   `aria-disabled` rather than `disabled` — the reason a key is dead is a
 *   sentence printed on the plate above, and `disabled` takes the key out of the
 *   tab order and that sentence out of reach with it.
 * - **The name is a live region.** The step keys are labelled "narrower" and
 *   "wider", which is what they *do* and not what the board became — so the one
 *   thing a press changes has to announce itself, or the control is only legible
 *   to someone who can see the readout. That matters more now than it did in the
 *   old block: the plate naming the circle in words scrolls away, and from there
 *   on this readout is the only place the answer is written.
 */
function CircleAperture({
  circle,
  hasAccount,
  onChange,
}: {
  circle: TradeCircle;
  hasAccount: boolean;
  onChange: (circle: TradeCircle) => void;
}) {
  const at = circleIndex(circle);
  const label = TRADE_CIRCLES[at].label;

  return (
    <div
      role="group"
      aria-label="Scope"
      // **A fixed width from `sm`, not a share of the row**, and the difference
      // is the whole legibility of the part. Sharing the row's slack, the
      // readout resized with whatever else was on the rail — `LEAGUEMATE
      // LEAGUES` came out as `LEAGU…` under the longest neighbour and full
      // width under the shortest, so the one thing the instrument exists to say
      // was the first thing to go. 19rem holds the longest circle name at this
      // face without truncating.
      //
      // Below `sm` it takes the row's slack rather than the whole row, because
      // the seek key rides beside it down there — 334px of rail less the key
      // and a gap leaves ~280, which still holds `LEAGUEMATE LEAGUES` whole.
      //
      // **The floor is what makes that a wrap rather than a collapse.** A
      // `flex-1` item bases at 0, so the count and the keys — which do not
      // shrink — pile onto the first line and take their width out of this one:
      // rendered without it, the readout came out as a 12px sliver with the
      // whole rail still fitting on two lines, which is a layout that measures
      // fine and cannot be read. 15rem is the narrowest the readout stays legible
      // at, and being unshrinkable below that is what pushes everything else to
      // the next line.
      className="flex min-w-[15rem] flex-1 items-center gap-2 sm:w-[19rem] sm:flex-none"
    >
      <StepKey
        to={stepCircle(circle, -1, hasAccount)}
        label="Narrow the scope"
        onChange={onChange}
      >
        ‹
      </StepKey>

      <span className="lab-readout flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-2.5">
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
 * it loses its wall rather than only dimming its glyph. It points at the plate's
 * sentence either way, which is where the reason lives.
 */
function StepKey({
  to,
  label,
  onChange,
  children,
}: {
  /** Where this key goes, or null when the ladder ends here. */
  to: TradeCircle | null;
  label: string;
  onChange: (circle: TradeCircle) => void;
  children: React.ReactNode;
}) {
  const dead = to === null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={dead || undefined}
      aria-describedby={dead ? CIRCLE_NOTE_ID : undefined}
      onClick={() => {
        if (to === null) return;
        onChange(to);
      }}
      className={`grid h-[30px] w-[26px] flex-none place-items-center rounded-lg text-[13px] leading-none ${
        dead
          ? "cursor-not-allowed text-foreground/30"
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
