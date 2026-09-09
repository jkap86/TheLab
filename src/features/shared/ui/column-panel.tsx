"use client";

import type { ReactNode, RefObject } from "react";

import type {
  KtcBoardChoice,
  KtcLineupChoice,
  LineupColumn,
  LineupPosition,
  LineupSlot,
  ManagerLineupsPayload,
} from "@/shared/contract";
import { isKtcMetric, readsQbBoard } from "@/shared/ktc/columns";

// Relative rather than through this folder's own barrel — the rule
// `lineup-columns-dialog.tsx` beside it already lives by: a module inside
// `features/shared` reaches its siblings directly.
import { CONSOLE_GLASS } from "../console-chrome";
import {
  adpBoardLabel,
  cellGapReason,
  column,
  COLUMN_SCOPE_LABELS,
  COLUMN_SCOPES,
  COLUMN_VALUE_LABELS,
  COLUMN_VALUES,
  IDP_LINEUP_POSITIONS,
  LINEUP_METRIC_LABELS,
  LINEUP_POSITION_LABELS,
  LINEUP_POSITIONS,
  LINEUP_SLOT_GROUPS,
  LINEUP_SLOT_LABELS,
  LINEUP_SLOTS,
  ktcChoiceLabel,
  metricAt,
  metricAxes,
  narrowingClause,
  positionGapReason,
  positionsLabel,
  slotGapReason,
  slotsLabel,
  type ColumnScope,
  type ColumnValue,
  type SlotGroup,
} from "../lineup-columns";
import { BilletFinish, Scanlines } from "./card-plate";
import { KtcBoardKeys, KtcLineupKeys, SwitchTrack } from "./ktc-board-keys";

/**
 * The column picker's chrome and its six axes, as two parts two dialogs stand
 * on.
 *
 * **It is an extraction rather than a component invented for a second reader.**
 * Every class string, shadow list and measurement here came out of
 * `LineupColumnsDialog`, which is where they were argued and where the notes
 * that explain them still live. What made a second panel — the standings pane's
 * own one-column picker — a copy risk rather than an ordinary new file is that
 * the thing being copied is *six switch tracks in one housing*: this console's
 * own rule is that a switch which stopped travelling in one of two spellings is
 * a panel nobody can see is broken, which is why `SwitchTrack` exists at all,
 * and six of them hand-copied is that failure six times over.
 *
 * So the two panels differ in exactly what they *are*, and share everything
 * they look like: one edits a rack of four bays and the other edits one column,
 * so the rack is the caller's; the case, its heading, the well, the axes
 * housing and the foot are here.
 */

/**
 * One axis of a press, with the rest of the column carried over.
 *
 * A partial rather than six functions, because the *rule* is one — change one
 * axis, keep the others — and spelling it per axis is six chances for one of
 * them to carry something over that the others do not.
 */
type Patch = {
  value?: ColumnValue;
  scope?: ColumnScope;
  format?: KtcBoardChoice;
  lineup?: KtcLineupChoice;
  positions?: readonly LineupPosition[];
  slots?: readonly LineupSlot[];
};

/** The position track's own vocabulary: the absence of a narrowing, then the nine. */
type PositionKey = "all" | LineupPosition;

const POSITION_KEYS: readonly PositionKey[] = ["all", ...LINEUP_POSITIONS];

const POSITION_KEY_LABELS: Record<PositionKey, string> = {
  all: "All",
  ...LINEUP_POSITION_LABELS,
};

/** What an un-narrowed column hands the track: `All` lit and nothing else. */
const ALL_ONLY: readonly PositionKey[] = ["all"];

/** The slot track's own vocabulary: the absence of a narrowing, then the seats
 * this account's leagues actually run. */
type SlotKey = "all" | LineupSlot;

const SLOT_KEY_LABELS: Record<SlotKey, string> = {
  all: "All",
  ...LINEUP_SLOT_LABELS,
};

const ALL_ONLY_SLOT: readonly SlotKey[] = ["all"];

/**
 * How many keys an equal-share row carries before its labels start to clip.
 *
 * **Measured, not chosen**: the position track is ten keys in the panel's 402px
 * track at desktop and 282px at a phone's, and that is the shipped, rendered
 * state — `All` and `DEF` both clear at both widths. A track longer than that is
 * the slot axis's alone, since it is the only one whose vocabulary is the
 * reader's own leagues, and at fifteen keys `flex-1` gives 23px of content each
 * and every label truncates to a letter. Past this the track wraps and sizes
 * each key to its own label instead — see {@link SwitchTrack.wrap}.
 */
const KEYS_PER_TRACK = 10;

/**
 * What a track out of force is handed: an array, so it stays in multi-select,
 * holding nothing.
 *
 * A shared empty rather than a literal at the call site, so the array identity
 * is stable across renders — a new `[]` each time is a new prop on a component
 * that has no reason to re-render for it.
 */
const NOTHING_LIT: readonly SlotKey[] = [];

/**
 * Why the two pricing axes are out of force, where they are.
 *
 * Spelled here rather than in `lineup-columns.ts` beside `slotGapReason`,
 * because these two are facts about *this panel's* grid — which value key is
 * unlit two rows above — where the slot rule is a fact about the column that
 * `column()` itself enforces. A reader following the dim looks up at `Proj` or
 * at `Capital`, and the wording names what they will find.
 */
const MARKET_OFF = "Only a KeepTradeCut column reads a market";
const QB_BOARD_OFF = "A projection is not priced on a draft board";

/**
 * The picker's case: a native `<dialog>` carrying a heading, one hole holding
 * everything a reader touches, and a foot.
 *
 * **It is a milled part on top of the page rather than a patch of it**, and
 * that is the whole of what this case is for. It used to paint in
 * `--panel-bg` — which is the page, since `ConsoleGround` paints the same
 * radial — so the two bottomed out on the same `#08090a` and the lower two
 * thirds of the case's edge simply were not there. A backdrop alpha cannot
 * separate two identical gradients; a *part* can, so the case is billet stock
 * chamfered on all four edges, and the well cut in it is what says the panel
 * is standing on the page without spending a shadow on saying it.
 *
 * `showModal()` is the caller's — it owns the ref and the trigger — which is
 * what keeps this a shape rather than a controller. Closing on a backdrop click
 * is here, because it is a property of the case: the dialog element is only
 * ever the click target when the click landed outside the panel. What that
 * close *means* is the caller's again, through {@link ColumnPanel.onClose}.
 */
export function ColumnPanel({
  dialogRef,
  label,
  title,
  reading,
  copy,
  wideCopy,
  ktc,
  warning,
  onClose,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  /** The dialog's accessible name. */
  label: string;
  /** The case's own heading. */
  title: string;
  /**
   * The lit readout at the header's right end, and the one thing on the panel
   * that moves under a press — which is why it is `aria-live` and why it is
   * drawn on glass rather than as loose mono.
   */
  reading: string;
  /** The line at the top of the well: what this panel is for. */
  copy: string;
  /** What is appended to it from `sm`, where there is a line's room for it. */
  wideCopy: string;
  /** Which markets answered and when each was scraped; empty when none could. */
  ktc: ManagerLineupsPayload["ktc"];
  /**
   * What leaving will do to a *second* bay, where the draft is a column one
   * already holds — `Bay 03 trades places`, and absent where there is nothing
   * to trade.
   *
   * **It is the foot's other reading rather than a line added beside one.** The
   * exchange used to be stated in `Save`'s `title`, which is the one thing that
   * key did that survived the deferral; with every exit seating there is no
   * key to hang it on, so it is shown here and marked on the bay itself rather
   * than narrated by a control nobody has hovered.
   */
  warning?: string;
  /**
   * Every way out of the case, as one handler.
   *
   * `close` fires for Esc, for `.close()` from `Done` **and** for the backdrop
   * path below, which is why this is one prop on the element rather than three
   * wirings at three call sites: two of those exits are `showModal()`'s rather
   * than the caller's, so a panel that seated on its own key alone would have
   * moved the trap rather than removed it.
   */
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      // Closing on a backdrop click: the dialog element itself is only ever
      // the click target when the click landed outside the panel. It goes
      // through `.close()`, so it reaches `onClose` with the other two.
      onClick={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      onClose={onClose}
      aria-label={label}
      // 560px, which is what ten position keys need to keep their legends —
      // a 448px case gave `DEF` three characters.
      //
      // It still scrolls rather than clipping. The panel fits the UA's
      // `max-height` at both widths, but a `<dialog>` that hides its overflow
      // puts *Done* somewhere no scroll can reach the day a reader's own type
      // scale or a long metric name pushes it over — which is the state one
      // rewrite of this panel already found it in. `overflow-y-auto` still
      // clips to the radius, which is the whole of what the finish overlays
      // below need and the reason no `overflow-hidden` is written beside it:
      // a shorthand and a longhand for one property, at one specificity, is
      // the emit-order coin flip this file's constants are split apart to
      // avoid — and the side that loses here is the panel's ability to scroll.
      //
      // **The case is billet stock, not `--panel-bg`.** That token is the page
      // — `ConsoleGround` paints the same radial — so a dialog wearing it
      // bottoms out on the ground's own `#08090a` and the lower two thirds of
      // its edge disappear. No backdrop alpha separates two identical
      // gradients; a case that is a *part* does, and `--panel-case-shadow` is
      // that part's chamfer read at case scale over a two-stage cast. It is
      // one list because a shadow list is atomic: a second `shadow-[…]` beside
      // it would replace the four insets rather than add to them.
      //
      // The colour under the image is a fallback nothing paints over — the
      // gradient covers the border box — and it is a *case* colour rather than
      // `--background` on purpose: if it ever showed, a flat case is a worse
      // drawing and a page-coloured one is the bug this replaced.
      className={
        "lab-scroll m-auto max-h-[calc(100dvh-2rem)] w-[min(35rem,calc(100vw-2rem))] " +
        "overflow-y-auto overscroll-contain rounded-[1.75rem] bg-[#2e3f45] " +
        "bg-[image:var(--panel-case-bg)] p-0 text-foreground backdrop:bg-black/80 " +
        "shadow-[var(--panel-case-shadow)]"
      }
    >
      {/* The finish wraps the *content* rather than the dialog's own box, which
          is the same call the panel grain has always made here: an `inset`
          overlay on a scroll container is positioned against the padding box at
          its unscrolled origin, so on a scrolled panel it would end at the
          fold. Wrapping the content, it frames whatever the case actually
          holds. */}
      <div className="relative">
        {/* **The grain and the raking specular are what make a pale face read
            as milled** rather than as a flat fill, and at case scale that is
            the difference between a part and a panel. They are the league
            card's own two overlays, unchanged — there is no case finish, only
            a billet's seen larger.

            The bezel ring that used to sit here is gone with the dark case it
            was drawn for: a 5.5% white hairline inset from the edge reads as a
            scratch on light stock, and the case's own 3px chamfer is the edge
            now. */}
        <BilletFinish />

        {/* **The header band is gone and the title sits on the case itself.**
            A billet bolted to a billet says nothing — the case *is* the part
            now, so what was a band standing proud of a dark body is a heading
            stamped into the face it stands on, and the hairline below is the
            only cut it needs. */}
        <div className="relative flex items-center justify-between gap-3.5 px-5 pb-[0.8125rem] pt-4">
          {/* Ink on metal, not the readout's mint: a label stamped into a
              machined face is the metal's own colour lightened, and drawing it
              in mint would say the case was a window. */}
          {/* **The row is one line at every width, and both halves of that are
              load-bearing.** The heading never wraps and never shrinks; the
              readout takes whatever is left and truncates into it. The
              alternative is what a render found: at 390 the row's content box
              is ~320px, a two-word heading takes ~155 of it and a reading
              naming a setting takes ~155 more, so the row wrapped — and the
              case grew 13px past its own `100dvh - 2rem` cap under the press
              that lengthened its reading. Nothing on this panel may move under
              a press; that is the rule the three out-of-force tracks keep their
              places for and the rule the `Reads` window reserves its lines for,
              and this is the one part where a *variable* reading could break
              it.

              Truncation costs nothing that is not on screen: what the reading
              names in four characters, the `Reads` window below states in a
              sentence, and the `aria-live` text is whole whatever the box does
              to it. */}
          <h2 className="m-0 shrink-0 whitespace-nowrap font-display text-[length:var(--fs-15)] font-semibold uppercase tracking-[0.13em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
            {title}
          </h2>
          <span
            className={`${CONSOLE_GLASS} inline-flex min-w-0 items-center gap-[0.4375rem] rounded-lg border border-black/70 px-2.5 py-[0.3125rem]`}
          >
            <Scanlines />
            <span
              aria-hidden
              className="relative size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_6px_var(--accent-glow)]"
            />
            <span
              aria-live="polite"
              className="relative truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]"
            >
              {reading}
            </span>
          </span>
        </div>

        {/* The cut under the heading: a milled line with the light catching its
            far lip, inset from both edges so it reads as a cut in the face
            rather than as a rule drawn across the panel.

            `--milled-hairline` rather than the design's own `rgba(0,0,0,0.55)`,
            which is that value to the eye on this stock and is the half of it
            that turns over — a cut stays a cut on a pale face, and a black
            alpha there is the one thing it cannot be. */}
        <span
          aria-hidden
          className="relative mx-4 block h-px bg-[image:linear-gradient(to_right,transparent,var(--milled-hairline),transparent)] shadow-[0_1px_0_rgba(255,255,255,0.10)]"
        />

        {/* **The well: one hole cut in the case, holding everything a reader
            touches.** `CONSOLE_PART_TRAY`'s part-and-hole distinction at case
            scale — the case is the part and this is the absence of one — and
            it is what says the panel is on top of the page rather than a patch
            of it, without spending a shadow on saying so.

            **The 18px rule.** `mx-2` of margin plus `px-2.5` of padding is 18px
            a side, which is exactly what the old body's `px-[1.125rem]` spent,
            and it is not adjustable: `SwitchTrack`'s keys are `flex-1` from
            `sm` up, so every key takes an identical share of its track, and the
            track is 412px at the case's 560. A first pass spent 60px a side
            instead, which took it to 388 and clipped `FLEX` to `FL…` on the one
            axis whose entire point is naming a seat. Change either number and
            change the other to keep the sum, then re-measure that the `Slot`
            group is 412px with no key reporting `scrollWidth > clientWidth`.
            See {@link KEYS_PER_TRACK}. */}
        <div className="relative mx-2 mt-3.5 rounded-[1.25rem] bg-[color:var(--case-well-bg)] px-2.5 pb-[1.0625rem] pt-[0.9375rem] shadow-[var(--case-well-shadow)]">
          {/* One step up in contrast against the darker ground it now sits on. */}
          <p className="m-0 font-mono text-[length:var(--fs-11)] leading-[1.5] text-foreground/70">
            {copy}
            <span className="hidden sm:inline"> {wideCopy}</span>
          </p>

          {children}
        </div>

        {/* **The foot leaves the well and stands on the case's own face.** What
            it holds is a reading and the one control that commits, and neither
            is something a reader touches on the way to composing a column. */}
        <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 px-5 pb-4 pt-3.5">
          {/* **One slot, two readings**, so nothing appears or disappears under
              a press — the rule the three out-of-force tracks and the header's
              own reading already live by. The exchange is the louder of the two
              and takes the slot while it is true; the scrape line has it the
              rest of the time.

              The collision is deliberately **not** a second live region. The
              header's reading is already one, and the fact this states is
              carried in the marked bay's own accessible name — where a reader
              meets it on the control it is about, rather than as a second
              announcement racing the first on every press. */}
          {warning ? (
            <p className="m-0 inline-flex items-center gap-2 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-readout [text-shadow:var(--readout-text-glow)]">
              <span
                aria-hidden
                className="size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_7px_var(--accent-glow)]"
              />
              {warning}
            </p>
          ) : (
            // What was read and when — silent where nothing could be, since the
            // KTC columns already say so with their em dashes. That silence is
            // not the fluctuation the rule above forbids: the cap is `ml-auto`
            // and taller than this line, so a foot that gains one neither moves
            // the cap nor changes its own height.
            ktc.length > 0 && (
              <p className="m-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
                KTC
                {ktc.map((board) => (
                  <span key={board.format}>
                    {" · "}
                    {board.format === "dynasty" ? "dyn" : "red"}{" "}
                    {board.updated_at ? scrapedAt(board.updated_at) : "—"}
                  </span>
                ))}
              </p>
            )
          )}
          {/* **`Done` is the accent cap**, which is the rack's own rule for a
              control that acts on the page — and this is now the only key in
              the panel that commits, since closing is what seats. One label in
              one state: there is no dirty arm and no `Save & close`, because
              every exit seats and a key that describes two outcomes would be
              describing one it cannot reach.

              The shadow is composed whole in one utility on
              `RackControlsKeys`' terms: two `shadow-[…]` of one specificity is
              the emit-order flip, and a cap that lost its dome is its visible
              half. */}
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="lab-anim ml-auto inline-flex shrink-0 items-center rounded-xl border border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] px-[1.625rem] py-2.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[var(--cap-accent-ink)] [text-shadow:var(--cap-ink-emboss)] shadow-[var(--cap-accent-shadow)] transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 motion-safe:active:translate-y-0.5"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * The six axes of one column, in one machined housing, over a `Reads` window
 * that says what they compose to.
 *
 * **A press composes the whole column and hands it back**, which is what makes
 * the grid's holes visible rather than silently routed around: sitting on
 * `Proj · Starters` and pressing `Capital` gives `Capital · Starters`, not
 * `Capital · Roster`, and sitting on `All` and pressing `Proj` has no metric
 * behind it — so the key greys with its reason instead of quietly moving the
 * scope and answering a question nobody asked. What the caller does with the
 * column it is handed — hold it as a draft, seat it, store it — is the caller's,
 * and it is the whole of what the two dialogs standing on this differ by.
 *
 * **Nothing here appears or disappears under a press.** `Market`, `QB board`
 * and `Slot` used to mount only on the columns that read them, so pressing
 * `Capital` on a KeepTradeCut column took a row out from under the reader's
 * cursor and resized the case mid-sitting. They keep their places and go **out
 * of force** instead — dimmed keys, a dimmed legend and the reason in every
 * key's title — and the row that explains each dim is the unlit key one or two
 * tracks above it.
 *
 * **`Save` is gone from this ledge, and what it did is now what leaving
 * does.** It was the smallest key on the panel — `--fs-9`, beside a name at
 * `--fs-15` and under a `Done` that is the largest key in the foot — and it
 * was dark and unpressable most of the time it was on screen, which is a key a
 * reader stops reading. Readers changed a column, pressed `Done`, and lost the
 * edit silently. Every exit seats now (see the two dialogs' own `save`), so
 * there is nothing left for a key here to do, and the name takes the width it
 * freed. What is left of it is the state: the caller's chip says `· Edit`
 * while a draft is in hand, and the housing's own accent ring comes up with
 * it.
 */
export function ColumnAxes({
  chip,
  column: col,
  slots = [],
  dirty,
  onChange,
}: {
  /** What the ledge's lit pill names — a bay's number, or the pane it configures. */
  chip: string;
  /** The column being edited: a caller's draft, else what it has seated. */
  column: LineupColumn;
  /**
   * The starting seats this account's leagues actually run — `slotsInHand` over
   * the caller's own league list, in canonical order.
   *
   * **The offered vocabulary, not the whole one**: a key for a seat no league
   * starts is a narrowing that could never seat anybody, which is the rule the
   * position axis's list already lives by. Empty is a real state — an account
   * whose leagues have no `roster_positions` stored yet — and the track is
   * omitted entirely there rather than drawn as a lone `All`, which is a switch
   * with one detent. That is not the fluctuation the always-mounted rule
   * forbids: the vocabulary is a prop and cannot move under a press.
   */
  slots?: readonly LineupSlot[];
  /**
   * Whether there is a draft in hand — what lifts the housing's accent ring.
   *
   * It outlived the `Save` key it used to light, and that is deliberate rather
   * than a leftover: with every exit seating, the one thing left to say about
   * an edit is that there *is* one, and the ring saying it is what makes the
   * caller's `· Edit` chip a reading of the part rather than a word beside it.
   */
  dirty: boolean;
  /** A press that composed a valid column. */
  onChange: (column: LineupColumn) => void;
}) {
  const axes = metricAxes(col.metric);
  const words = LINEUP_METRIC_LABELS[col.metric];

  /**
   * The column a press would write: the axis pressed, and **every other axis
   * carried over**.
   *
   * The two forcings the design states as behaviours are **`column`'s, not a
   * branch here**: a non-KeepTradeCut value takes both market axes back to
   * `auto` (which is what lets `lineupColumnKey` fold those five to a bare id,
   * so a stray board cannot become a second, un-removable copy of a projections
   * column), and `ktc_picks` takes the position set to empty (a draft pick has
   * no position). One constructor, so a press and a stored value cannot come to
   * disagree about either.
   */
  const candidate = (patch: Patch): LineupColumn | null => {
    const metric = metricAt(patch.value ?? axes.value, patch.scope ?? axes.scope);
    return metric
      ? column(
          metric,
          patch.format ?? col.format,
          patch.lineup ?? col.lineup,
          patch.positions ?? col.positions,
          patch.slots ?? col.slots,
        )
      : null;
  };

  /**
   * Why a press is off, or null where it can be made.
   *
   * One claim: the pairing has no metric behind it at all —
   * `cellGapReason`, the grid's one remaining hole — and that is a reading
   * which cannot exist. A grey with no title is still a key a reader cannot
   * find out anything about, which is what this panel's
   * disable-rather-than-correct rule cannot afford.
   */
  const why = (patch: Patch): string | null =>
    candidate(patch)
      ? null
      : cellGapReason(patch.value ?? axes.value, patch.scope ?? axes.scope);

  /** Compose a press and hand it up, or refuse it — which the key that made it
   * is already grey for. */
  const press = (patch: Patch) => {
    const next = candidate(patch);
    if (next && !why(patch)) onChange(next);
  };

  /**
   * What the position set becomes when one key is pressed.
   *
   * **`All` is not a tenth position**, it is the absence of a narrowing: it
   * empties the set, and turning the last lit position off returns there by
   * arithmetic rather than by a special case. The order is never press order —
   * `column` runs the set through `normalizeLineupPositions`, which sorts it
   * into the axis's own canonical order, because the bay's second line and the
   * `Reads` sentence both print it and press order would make one column read
   * two ways.
   */
  const toggled = (key: PositionKey): LineupPosition[] =>
    key === "all"
      ? []
      : col.positions.includes(key)
        ? col.positions.filter((one) => one !== key)
        : [...col.positions, key];

  /** The same, one axis over — `column` sorts either set into canonical order. */
  const toggledSlot = (key: SlotKey): LineupSlot[] =>
    key === "all"
      ? []
      : col.slots.includes(key)
        ? col.slots.filter((one) => one !== key)
        : [...col.slots, key];

  /**
   * Why a position key is off.
   *
   * `All` is never off — it is the absence of a narrowing rather than a
   * narrowing to everything, so there is no column it could fail to write. The
   * nine are off wholesale on a `KTC · Picks` column (`positionGapReason`), and
   * that is the only reason.
   *
   * It stays **per key** rather than becoming the whole-axis `offReason` the
   * three tracks above it take, and the difference is `All`: it is still live on
   * a picks column, because the absence of a narrowing is a state that column
   * genuinely holds. An axis is out of force when *nothing* in it can be
   * pressed.
   */
  const positionOff = (key: PositionKey): string | null =>
    key === "all" ? null : positionGapReason(axes.scope);

  /**
   * The seats this track offers: the leagues' own union, plus anything the
   * column being edited already names.
   *
   * The second half is a guard rather than a nicety and it is silent without:
   * a stored column narrowed to `SUPER_FLEX` outlives the superflex league
   * leaving the account, and drawn against the union alone its track would show
   * `All` unlit with no key lit either — a narrowing on screen in the second
   * line that the control cannot name. `normalizeLineupSlots` keeps such a
   * column valid deliberately (see its note), so the picker has to be able to
   * show it.
   */
  const offeredSlots = LINEUP_SLOTS.filter(
    (one) => slots.includes(one) || col.slots.includes(one),
  );
  const slotKeys: readonly SlotKey[] = ["all", ...offeredSlots];
  /**
   * Where the milled cuts fall: before the first *offered* slot of each run
   * after the first.
   *
   * Computed against what is on screen rather than spelled as "before `FLEX`",
   * because the track offers a subset — an account whose only flex is a
   * superflex would get no cut at all from a fixed key, and the bare seats and
   * the flexes would read as one run.
   */
  const slotCuts = new Set<SlotKey>();
  let lastGroup: SlotGroup | null = null;
  for (const one of offeredSlots) {
    const group = LINEUP_SLOT_GROUPS[one];
    if (lastGroup !== null && group !== lastGroup) slotCuts.add(one);
    lastGroup = group;
  }
  /** Why the slot axis is out of force, or undefined where it is in force. */
  const slotsOff = slotGapReason(axes.scope) ?? undefined;

  return (
    // **The accent is a hairline ring inside the shadow list rather than a
    // `border`**, so the four chamfer insets and the accent cannot fight over
    // one border colour — the emit-order flip this console's constants are
    // split apart to avoid, one property over.
    //
    // **It comes up while a draft is in hand**, which is the part of `Save`
    // that survived the key: the ring and the caller's `· Edit` chip are the
    // whole of what says an edit is live, so the housing itself has to carry
    // one of them. Two whole lists rather than a lit `shadow-[…]` appended to
    // a resting one — a shadow list is atomic, so the second would replace the
    // four chamfer insets rather than raise the ring inside them.
    <div
      className={
        "relative mt-3.5 overflow-hidden rounded-[1.0625rem] " +
        (dirty
          ? "shadow-[inset_0_1.5px_0_rgba(255,255,255,0.2),inset_0_-1.5px_0_rgba(0,0,0,0.8),inset_1px_0_0_rgba(255,255,255,0.05),inset_-1px_0_0_rgba(0,0,0,0.5),0_0_0_1px_rgba(0,255,229,0.35),0_3px_0_rgba(0,0,0,0.55),0_14px_26px_-12px_rgba(0,0,0,0.9),0_0_34px_-12px_var(--accent-glow)]"
          : "shadow-[inset_0_1.5px_0_rgba(255,255,255,0.2),inset_0_-1.5px_0_rgba(0,0,0,0.8),inset_1px_0_0_rgba(255,255,255,0.05),inset_-1px_0_0_rgba(0,0,0,0.5),0_0_0_1px_rgba(0,255,229,0.2),0_3px_0_rgba(0,0,0,0.55),0_14px_26px_-12px_rgba(0,0,0,0.9),0_0_34px_-18px_var(--accent-glow)]")
      }
    >
      {/* The housing's own header ledge, above its body in stacking order so
          its cast lands on it — the header band's argument one grain smaller. */}
      <div
        // The ledge's *face* alone rather than `CONSOLE_WINDOW_LEDGE`, on
        // `CONSOLE_BILLET_FACE`'s rule: that constant carries
        // `--window-ledge-shadow` and a shadow list is atomic, so a second
        // `shadow-[…]` beside it replaces the chamfer rather than casting under
        // it — and which wins is Tailwind's emit order.
        className="relative z-[2] flex items-center gap-2.5 bg-[image:var(--window-ledge-bg)] px-[0.8125rem] py-2.5 shadow-[var(--window-ledge-shadow),0_2px_0_rgba(0,0,0,0.7),0_8px_14px_-8px_rgba(0,0,0,0.85)]"
      >
        <span
          className={`${CONSOLE_GLASS} inline-flex shrink-0 items-center gap-1.5 rounded-full border border-active/45 px-2.5 py-1`}
        >
          <Scanlines />
          <span
            aria-hidden
            className="relative size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_7px_var(--accent-glow)]"
          />
          <span className="relative font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout [text-shadow:var(--readout-text-glow)]">
            {chip}
          </span>
        </span>
        {/* **The name takes the width `Save` used to.** It is a step up with
            it — `--fs-16` where the ledge's own chip stays at `--fs-10` — which
            is what the ledge is for: one line naming the thing the six tracks
            under it are axes of. It still truncates, on a card too narrow to
            hold a metric's whole name. */}
        <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-16)] font-semibold tracking-[-0.005em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
          {words.column}
        </span>
      </div>

      <div className="relative flex flex-col gap-[0.5625rem] bg-[image:var(--key-bg)] px-3 py-[0.8125rem]">
        <SwitchTrack
          label="Value"
          legend
          options={COLUMN_VALUES}
          value={axes.value}
          onChange={(value) => press({ value })}
          labels={COLUMN_VALUE_LABELS}
          className=""
          size="row"
          unavailable={(value) => why({ value })}
        />
        <SwitchTrack
          label="Scope"
          legend
          options={COLUMN_SCOPES}
          value={axes.scope}
          onChange={(scope) => press({ scope })}
          labels={COLUMN_SCOPE_LABELS}
          className=""
          size="row"
          unavailable={(scope) => why({ scope })}
        />

        {/* **The Scope axis's own second line.** A seat is a thing only a
            starting lineup has, so off the `starters` scope the whole track
            goes out of force — and it keeps its place, because `Starters` unlit
            one row above is what says *why* it is dim and a row that vanished
            under a press would take the answer with it.

            Omitted only where the account offers no seats at all, which is not
            that fluctuation: the vocabulary is a prop, so it cannot move under
            a press, and a track holding `All` alone is a switch with one
            detent. */}
        {offeredSlots.length > 0 && (
          <SwitchTrack
            label="Slot"
            legend
            options={slotKeys}
            // Out of force lights nothing — not even `All`, which would read as
            // a narrowing this column is in force on.
            value={
              slotsOff
                ? NOTHING_LIT
                : col.slots.length === 0
                  ? ALL_ONLY_SLOT
                  : col.slots
            }
            onChange={(key) => press({ slots: toggledSlot(key) })}
            labels={SLOT_KEY_LABELS}
            className=""
            size="row"
            offReason={slotsOff}
            divider={(key) => slotCuts.has(key)}
            // The one track whose vocabulary is the reader's own leagues, and
            // therefore the one that can outgrow its row. See
            // {@link KEYS_PER_TRACK} for the bound and {@link SwitchTrack.wrap}
            // for what crossing it buys.
            wrap={slotKeys.length > KEYS_PER_TRACK}
          />
        )}

        {/* **These two used to mount only on the columns that read them, and
            that was the fluctuation.** They keep their places and go out of
            force instead, with the reason in every key's title and the legend
            dimmed with them — and the unlit key one or two rows above is what
            explains each dim.

            They are still two tracks rather than a pair, because the two axes
            are read by different metrics. A *market* is KeepTradeCut's own. A
            *QB board* is a fact about how the league starts quarterbacks and
            both priced valuations split on it, so a capital column reads it
            too. A projection reads neither. */}
        <KtcBoardKeys
          board={col.format}
          onChange={(format) => press({ format })}
          size="row"
          legend
          className=""
          offReason={isKtcMetric(col.metric) ? undefined : MARKET_OFF}
          unavailable={(format) => why({ format })}
        />
        <KtcLineupKeys
          lineup={col.lineup}
          onChange={(lineup) => press({ lineup })}
          size="row"
          legend
          className=""
          offReason={readsQbBoard(col.metric) ? undefined : QB_BOARD_OFF}
          unavailable={(lineup) => why({ lineup })}
        />

        {/* **The milled cut is copy, not rhythm.** Position *narrows* the two
            axes above it rather than being a third of them, and the cut is the
            only thing on the panel that says so. */}
        <span
          aria-hidden
          className="h-px bg-[image:var(--groove)] shadow-[0_1px_0_rgba(255,255,255,0.05)]"
        />

        <SwitchTrack
          label="Position"
          legend
          options={POSITION_KEYS}
          // The caller maps its own state into the track's vocabulary, which is
          // what lets `All` be a key here and the absence of a narrowing
          // everywhere else — the track lights what it is handed and this owns
          // the toggle.
          value={col.positions.length === 0 ? ALL_ONLY : col.positions}
          onChange={(key) => press({ positions: toggled(key) })}
          labels={POSITION_KEY_LABELS}
          className=""
          size="row"
          unavailable={positionOff}
          // **`K` and `DEF` sit with the four skill positions and the three
          // individual-defender families sit apart from both**, because those
          // are the groups a league actually starts. Read off the vocabulary
          // rather than spelled as indices, so a position the solver learns
          // lands on the right side of the cut instead of shifting a number
          // nobody would think to update.
          divider={(key) =>
            key === LINEUP_POSITIONS[0] || key === IDP_LINEUP_POSITIONS[0]
          }
        />

        {/* **What the column reads, in words**, composed on every press from
            the metric's own sentence, the board clause and the narrowing. It is
            the one thing a four-character unit over a board pair cannot say:
            `KTC · Dyn · SF` does not tell a reader the number includes the
            picks. */}
        <div
          className={`${CONSOLE_GLASS} mt-[0.1875rem] flex flex-col gap-1 rounded-[0.625rem] border border-black/70 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-2.5`}
        >
          <Scanlines />
          <span
            aria-hidden
            className="relative font-mono text-[length:var(--fs-9)] uppercase leading-[1.45] tracking-[0.16em] text-readout-label sm:w-[4.875rem] sm:shrink-0"
          >
            Reads
          </span>
          {/* **Three lines reserved, not two.** A priced column appends a board
              clause *on top of* a narrowing — "Draft capital off ADP — the
              starters only. Off each league's own draft board. In the FLEX and
              superflex seats only." — which is three lines in this window's
              ~386px measure, so `Proj ↔ Capital` moved the case 17.7px under
              the reader's finger. Three is the longest a *toggle* can produce;
              a reader who lights eight seats and three positions still grows
              it, which is a sentence they built rather than one a press handed
              them.

              **Four below `sm`, and that is a measurement rather than a
              margin.** The label stacks above the paragraph there instead of
              standing beside it, so the window is the panel's own ~320px rather
              than ~386, and the same sentence takes a fourth line — measured,
              the case moved 18px on the `Proj ↔ Capital` press at 390 while
              holding still at 1280. A rule that holds at one width and not the
              other is half a rule, and a phone is where a case shifting under a
              thumb matters most. */}
          <p className="relative m-0 min-h-[5.8em] min-w-0 flex-1 font-mono text-[length:var(--fs-10-5)] leading-[1.45] text-readout-line text-pretty sm:min-h-[4.35em]">
            {reads(col)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A column's second line: what it is *set* to, then what it narrows to — the
 * seats first and the players in them second, which is the order the `Reads`
 * sentence puts them in and the order they compose in.
 *
 * **One spelling, and it has three readers now.** It is a bay's own second line
 * and that key's accessible name — two would be a rack that says one thing and
 * announces another — and it is the teams panel's live readout, where the
 * four-bay panel prints `Bay 01 / 04`: there is no bay count to state when
 * there is one column, and the setting is what actually moves.
 */
export function columnSetting(col: LineupColumn): string {
  const scope = LINEUP_METRIC_LABELS[col.metric].scope;
  const board = adpBoardLabel(col.lineup);
  const setting = isKtcMetric(col.metric)
    ? ktcChoiceLabel(col)
    : // **The scope and its board join tight, where the positions join
      // spaced**, and the difference is not a fudge for width: these two are
      // one reading — what was counted, priced on which board — where the
      // narrowing is a second clause about it. It is the spelling the card's
      // own tile already uses (`Roster·SF` beside `Dyn·SF`) for the same
      // reason and in the same 58px of line. Spaced, a render at 390 cut it to
      // `ROSTER ·…`: the ellipsis where the board should be, which is the one
      // part of the line a reader has forced.
      board
      ? `${scope}·${board}`
      : scope;
  // **A slot narrowing replaces the scope word rather than following it.**
  // `FLEX/SF` already says these are starting seats, where `Starters · FLEX/SF`
  // spends a third of a 58px line saying it twice. On a KeepTradeCut column there
  // is no scope word to replace — its line is the board pair — so the seats join
  // it spaced, the way the positions do. A forced capital board joins tight for
  // the reason above: the seats and the board they were priced on are one
  // reading.
  const seats = slotsLabel(col.slots);
  const head = !seats
    ? setting
    : isKtcMetric(col.metric)
      ? `${setting} · ${seats}`
      : board
        ? `${seats}·${board}`
        : seats;
  const narrowed = positionsLabel(col.positions);
  if (!narrowed) return head;
  return head ? `${head} · ${narrowed}` : narrowed;
}

/**
 * The column's whole reading: the metric's own sentence, its board clause, and
 * its narrowing.
 *
 * Three clauses composed rather than one string per column, which is what keeps
 * ten metrics × nine pricings × every seat and position set expressible without
 * a table nobody could keep true.
 */
export function reads(col: LineupColumn): string {
  const words = LINEUP_METRIC_LABELS[col.metric];
  const board = readsQbBoard(col.metric) ? ` ${boardClause(col)}` : "";
  // **The two narrowings are one clause, because they are one intersection.** A
  // slot picks the seats and a position picks who is sitting in them; two
  // sentences would read as two independent filters a reader has to multiply
  // out for themselves. `narrowingClause` is the one spelling, and it falls
  // back to `positionsClause` where no seat is named.
  return `${words.option}${board}${narrowingClause(col.slots, col.positions)}`;
}

/**
 * The board clause a priced column's sentence ends with.
 *
 * Both axes on `auto` collapse to one short phrase rather than spelling the
 * rule twice — "on each league's own market, at each league's own prices" says
 * in two lines what "its own board" says in three words. A capital column has
 * only one axis to name and names it in the ADP vocabulary, because "the
 * superflex board" means a different thing to a reader who has just come from a
 * KeepTradeCut bay: there it is a column of prices, here it is which drafts the
 * average was pooled from.
 */
function boardClause(col: LineupColumn): string {
  const prices =
    col.lineup === "auto"
      ? "each league's own prices"
      : col.lineup === "sf"
        ? "superflex prices"
        : "1QB prices";
  // A capital column has no market to name, so the sentence is the QB board
  // alone — and it is spelled out even on `auto`, where the second line stays
  // silent: the window is where there is room to say what a rule means, and
  // "each league's own draft board" is exactly the thing a reader who has never
  // pressed this track would otherwise have to infer.
  if (!isKtcMetric(col.metric)) {
    return col.lineup === "auto"
      ? "Off each league's own draft board."
      : `Off the ${col.lineup === "sf" ? "superflex" : "1QB"} draft board.`;
  }
  if (col.format === "auto" && col.lineup === "auto") {
    return "On each league's own board.";
  }
  const market =
    col.format === "auto"
      ? "each league's own market"
      : `the ${col.format} board`;
  return `On ${market}, at ${prices}.`;
}

/**
 * How long ago the board was scraped, in the coarsest unit that is still true.
 *
 * Relative rather than a clock time, because the question a reader has is "are
 * these current", not "what time is it in the server's zone" — and coarse,
 * because the sync's own TTL is fifteen minutes, so anything finer would be
 * precision the number does not have. Rendered client-side after hydration like
 * everything else in this panel, so there is no server/client clock to
 * disagree.
 */
function scrapedAt(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
