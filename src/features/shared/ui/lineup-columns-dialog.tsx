"use client";

import { memo, useRef, useState } from "react";

import type {
  LineupColumn,
  LineupSlot,
  ManagerLineupsPayload,
} from "@/shared/contract";
import { lineupColumnKey } from "@/shared/ktc/columns";

// Relative rather than through this folder's own barrel — the rule
// `league-filters-dialog.tsx` beside it already lives by: a module inside
// `features/shared` reaches its siblings directly.
import {
  CONSOLE_BILLET_FACE,
  CONSOLE_GLASS,
  CONSOLE_PART_TRAY,
  CONSOLE_KEY_PILL,
  CONSOLE_WINDOW_LEDGE,
} from "../console-chrome";
import {
  arrangeLineupColumns,
  COLUMN_VALUE_LABELS,
  LINEUP_METRIC_LABELS,
  MAX_LINEUP_COLUMNS,
  metricAxes,
  normalizeLineupColumns,
  storeLineupColumns,
} from "../lineup-columns";
import { ColumnAxes, ColumnPanel, columnSetting } from "./column-panel";
import { Scanlines } from "./card-plate";

type ColumnsDialogProps = {
  /** The chosen columns, already in canonical order — see `useLineupColumns`. */
  columns: readonly LineupColumn[];
  /** Which markets answered and when each was scraped; empty when none could. */
  ktc: ManagerLineupsPayload["ktc"];
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
  /** The trigger's shape — see `LeagueFiltersDialog`, which is shaped the same way. */
  triggerClassName?: string;
};

/**
 * The column picker: a trigger key and a native `<dialog>`, which is the whole
 * reason there is no dependency here — `showModal()` brings the focus trap,
 * the Esc-to-close and the `::backdrop` with it.
 *
 * **The bay you select is the thing you are editing**, and that one idea is
 * what this panel is. Add and edit used to be two regions — a rack of four
 * bays, and under it a list of nine keys each carrying a full sentence, with
 * the chosen ones repeating that sentence inside their bay. Twelve sentences in
 * a 448px column measured 1218px at desktop, against a `<dialog>`'s own budget
 * of about 812px: it scrolled, and *Done* sat well below the fold. Selecting a
 * bay is the only navigation, the tracks under the rack are that bay's own
 * axes, and the panel is 560px wide because ten position keys need it to keep
 * their legends.
 *
 * **The nine metric keys are gone because the nine metrics were never nine
 * questions.** They are a *value* crossed with a *scope* — see `METRIC_AXES` in
 * `lineup-columns.ts`, which is where that grid lives and where the two holes in
 * it are argued. A reader picks the two, and the pairing that has no metric
 * behind it is greyed with its reason rather than being absent, which is what
 * the flat list was hiding.
 *
 * **All four bays are always set, and that is what the budget became.** There is
 * no `Add`, no `Clear`, no empty socket and no `n of 4`. Both of the arguments
 * this file used to carry for those are worth keeping, because both are answered
 * rather than abandoned:
 *
 * - *The empty socket* was how a reader saw that a column was free to take, and
 *   a full rack was how they saw that none was. With every bay occupied the
 *   shape says neither — because there is nothing left to say. A press replaces
 *   what a bay reads; nothing is ever gained or lost, so there is no budget to
 *   describe. What the shape does still say is *one of four*, which is why the
 *   selected bay is the only one lifted out of the tray.
 * - *`Clear`* stood where `Editing` stands now, and it is gone with the socket
 *   it emptied into: a bay cannot be cleared to nothing when nothing is not a
 *   state a bay has. The bound it carried — the last bay standing cannot be
 *   emptied — is not weakened but made unreachable, and `normalizeLineupColumns`
 *   is where that now lives: it tops a short selection back up to four rather
 *   than handing this panel a bay it has no way to draw. The failure that rule
 *   exists to stop is unchanged and worth restating, because it is silent:
 *   `normalize` falls back to `DEFAULT_LINEUP_COLUMNS` when handed an *empty*
 *   array, which is right for a stale stored value and catastrophic for a press
 *   — a reader clearing their last column would watch all four defaults come
 *   back with nobody having chosen them.
 *
 * **And the collision rule is gone, which is what deferring the edit bought.**
 * A press used to be refused where the column it would write was already in
 * another bay — checked against the whole column rather than the metric, since
 * two bays holding one metric on two boards is the comparison a dynasty reader
 * opens this panel to make. That was the right rule for a panel that wrote on
 * every press and it is the wrong one for a panel that saves: a duplicate is no
 * longer a press to refuse but a save to resolve, and it resolves by
 * **exchange** — the bay that already held the column takes what this one held,
 * so nothing is lost and the rack still holds four distinct readings. What is
 * still greyed is the grid's own hole (`cellGapReason`), because that is a
 * reading which cannot exist rather than one a sibling bay is sitting on.
 *
 * **The bay is the preview.** An earlier direction drew a preview tile under the
 * composer; here the selected bay updates on every press and is already drawn as
 * the tile it configures, so a second copy would be the same reading twice. What
 * is kept from that direction is the `Reads` line: the composed column stated in
 * words, on lit glass, under the tracks.
 *
 * **And the rack holds its sockets, which is what makes the bay a preview at
 * all.** The stored selection is a set in canonical order — that is the card's
 * tile order and it has not moved — but the panel used to draw the rack straight
 * off it, so a press that changed a column's place in the sort re-ordered the
 * rack under the reader's finger: pressing `KTC` on bay 01 sent that column to
 * bay 04 and slid the other three left. The panel *followed* it, correctly, and
 * that was not the fix — the lit bay was right and everything on screen had
 * still moved, which reads as the highlight jumping to a column the reader did
 * not choose. `sockets` below is the rack's own order, `arrangeLineupColumns`
 * seats the canonical set into it, and the only thing a press changes is what
 * the selected socket reads. The order is re-seeded on {@link open}, so a fresh
 * open is the card's order again and no arrangement outlives the sitting that
 * made it.
 *
 * **Editing is deferred, and the rack is what that is for.** A press used to
 * write straight through to the store, which meant crossing the grid — `Proj ·
 * Starters` to `KTC · Picks` — moved the tile under the reader's finger on
 * every step of the way, and each intermediate column was a real selection the
 * cards behind the dialog re-ranked for. A press edits a **draft** of the
 * selected bay now; the tracks and the housing header read it, and the four
 * tiles hold still until `Save` seats it. The store is still written on Save
 * alone, so `storeLineupColumns` and the socket order below are unchanged —
 * they just run once per save instead of once per press.
 *
 * **A draft belongs to the bay it was made in**, so selecting another abandons
 * it. The two alternatives — a pending mark on the tile, or refusing to move —
 * both make the rack carry state about an edit nobody has committed, which is
 * the thing the deferral exists to take *off* it.
 *
 * **Nothing on this panel appears or disappears under a press**, which is the
 * rule the three narrowing and pricing tracks now live by: `Market`, `QB board`
 * and `Slot` used to mount only on the columns that read them, so pressing
 * `Capital` on a KeepTradeCut bay took a row out from under the reader's cursor
 * and resized the case mid-sitting. They keep their places and go **out of
 * force** instead — dimmed keys, a dimmed legend and the reason in every key's
 * title — and the row that explains each dim is the unlit key one or two tracks
 * above it. `Save` is a key on the same terms: dark and unpressable with
 * nothing to seat rather than absent.
 *
 * **The KeepTradeCut board lives in the bay, not in this panel's foot.** A global
 * board key is contradicted by a column that names its own: the market is not a
 * property of the page, it is what one of these four columns *means*, and putting
 * it in the bay is what lets two bays hold one metric on two boards. What
 * survives of the old foot is the scrape line: these are someone else's numbers
 * on a fifteen-minute cache, and anything showing them should be able to say how
 * old they are.
 *
 * `storeKtcBoard` / `useKtcBoard` stay where they are — the trades board is a
 * different call site with a different argument (see that route on why one page
 * sends the choice and the other does not), and only the manager page's columns
 * stop reading a page-wide board.
 *
 * **The `Slot` axis breaks the starters scope out by seat**, and it is the
 * position axis's argument one grain in: that one narrows a column to the
 * *players* it counts and this one to the *seats*, so `FLEX` with `WR` counts
 * the wide receivers occupying flex seats and a reader can ask how their flex
 * seat ranks across their leagues rather than only how their starters do. The
 * two are one intersection and the `Reads` window states them as one clause for
 * that reason — two sentences would read as two independent filters somebody has
 * to multiply out.
 *
 * Its vocabulary is the **leagues in hand** rather than the whole table (see
 * `slotsInHand`), which is the same rule the position axis derives its list by
 * pointed at a different source: a key for a seat no league starts is a
 * narrowing that could never seat anybody, so such a slot is absent rather than
 * greyed. What *is* greyed is the whole track off the `starters` scope, a seat
 * being a thing only a starting lineup has.
 *
 * **The `Position` axis is here now, and this file used to argue it could not
 * be.** The argument was right at the time and is worth keeping: a track built
 * without a position on `LineupColumn`, a per-position total in
 * `lineupMetricTotals`, a figure on `LeagueTeam` and a rank in the route would
 * have been a control that reads a column nobody can compute. All four seams
 * landed, so the track is a control over something. Its vocabulary is
 * `FANTASY_POSITIONS`, derived from the solver's own `SLOT_POSITIONS` rather
 * than written here, which is what stops the panel offering a narrowing that can
 * never seat anybody.
 *
 * **The panel is machined rather than moulded**, which is the league card's own
 * billet / ledge / glass vocabulary read at case scale: a header band standing
 * proud of the case, four milled parts seated in a hole, and one housing for the
 * selected bay's axes. Nothing in the console's token set was added for it.
 *
 * **The case and the axes housing left this file when the standings pane got a
 * picker of its own**, and they are `column-panel.tsx` now. What is here is the
 * rack — which is the whole of what a four-bay panel *is* — and everything the
 * rack implies: the socket order, the selected bay, and the exchange `Save`
 * runs. What moved is everything the two panels look like, and it moved because
 * the thing that would otherwise have been copied is six switch tracks in one
 * housing: a switch that stopped travelling in one of two spellings is a panel
 * nobody can see is broken, which is the rule `SwitchTrack` itself exists for.
 *
 * **`memo`'d, on `LeagueFiltersDialog`'s terms**: it is mounted on a page
 * that re-renders on every line of a leagues stream, and its own render
 * derives the rack, the vocabulary and every track's state from props that
 * do not move between those lines. See {@link columnsDialogPropsEqual} for
 * the one prop compared by value.
 */
export const LineupColumnsDialog = memo(function LineupColumnsDialog({
  columns,
  ktc,
  slots = [],
  triggerClassName = `${CONSOLE_KEY_PILL} inline-flex items-center border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`,
}: ColumnsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  /**
   * Which bay is being edited.
   *
   * A bay *index*, because a bay is a socket on a rack rather than a column —
   * and now that the rack holds its sockets ({@link sockets} below) the index
   * is all it needs to be: a press rewrites what the selected socket reads and
   * leaves it selected, so nothing here has to chase a column through a
   * re-sort.
   *
   * Local and unpersisted, like the tab it replaced: which bay you were last
   * inside is a fact about this sitting.
   */
  const [active, setActive] = useState(0);

  /**
   * The rack's own socket order, as one {@link lineupColumnKey} per bay — or
   * null before anything has been edited, which is the canonical order.
   *
   * **The store is a set in canonical order and the rack is an arrangement of
   * it.** Those were one thing until a reader pressed a key: changing bay 01
   * from a projection to a KeepTradeCut column sorts that column to the end, so
   * a canonical rack teleported the tile being edited from the first socket to
   * the last and slid the other three left under the reader's finger. Following
   * it with the selection — which is what this panel did, correctly — kept the
   * *right* bay lit and still moved everything on screen. Held, the socket keeps
   * what it was just given and nothing else moves at all.
   *
   * It is re-seeded on every open rather than kept for the page's life, because
   * the rack is the tile strip it configures and a fresh open should read in the
   * card's own order; an arrangement is a fact about one sitting, like the
   * selected bay beside it.
   */
  const [sockets, setSockets] = useState<readonly string[] | null>(null);

  /**
   * The edit in progress on the selected bay, or null where there is none.
   *
   * **A press writes this and `Save` writes the store**, which is what keeps the
   * rack still while a reader crosses the grid: every intermediate column on the
   * way from `Proj · Starters` to `KTC · Picks` used to be a real selection, so
   * the tile under their finger moved on each step and the cards behind the
   * dialog re-ranked for a column nobody wanted. Held here, the four tiles are
   * the seated columns until there is something to seat.
   *
   * Null rather than seeded from the bay, so `dirty` is a comparison against the
   * seated column rather than a flag something has to remember to clear — and so
   * that abandoning is one `setDraft(null)` rather than a re-seed that could
   * land on the wrong bay.
   */
  const [draft, setDraft] = useState<LineupColumn | null>(null);

  /**
   * The rack's four bays, in socket order.
   *
   * Folded again here rather than trusted, and it is one idempotent call: every
   * line below indexes a bay without a guard, and the state that would break
   * them — a selection of three — is one `normalizeLineupColumns` cannot
   * produce. `MAX_LINEUP_COLUMNS` means *exactly* four for this reason.
   * `arrangeLineupColumns` only ever re-orders what that returns, so the count
   * and the membership are still its answer.
   */
  const canonical = normalizeLineupColumns(columns);
  const bays = arrangeLineupColumns(canonical, sockets);
  const bay = Math.min(Math.max(active, 0), bays.length - 1);
  /** What the selected bay currently holds — what the rack draws, and what
   * `Save` compares against. */
  const seated = bays[bay];
  /** What the tracks and the housing read: the edit in progress, else the seated
   * column. Every axis below is a fact about *this*, never about the rack. */
  const col = draft ?? seated;
  const dirty = lineupColumnKey(col) !== lineupColumnKey(seated);

  /**
   * Which other bay already holds the column being composed, or -1.
   *
   * **It words the Save key's title and disables nothing**, which is the whole
   * of what the collision rule became: a duplicate is resolved by exchange on
   * save rather than refused on press, so the only thing left to do about one is
   * to say what pressing `Save` will do — that the other bay takes what this one
   * held. A reader who could not be told that would watch two tiles change for
   * one press.
   */
  const duplicate = bays.findIndex(
    (one, i) => i !== bay && lineupColumnKey(one) === lineupColumnKey(col),
  );

  /**
   * Seat the draft in the selected bay, and leave the rack exactly as the reader
   * is looking at it.
   *
   * Two writes, and they are two different orders on purpose:
   * `storeLineupColumns` normalizes, so what is *stored* is the canonical set
   * the card's tile strip renders — while the socket order recorded beside it is
   * this rack's, which is the order on screen with one socket's contents
   * replaced. So the card re-sorts behind the dialog, as it must, and nothing in
   * the panel moves.
   *
   * The keys are taken from `all` rather than from the store's answer because
   * `all` *is* the arrangement: reading them back would be reading the canonical
   * order, which is the re-sort this exists to keep off the rack.
   */
  const save = () => {
    if (!dirty) return;
    const all = bays.map((c, i) => (i === bay ? col : c));
    // **The exchange.** A duplicate is not a press to refuse but a save to
    // resolve: the bay that already held this column takes what this one held,
    // so nothing is lost and the rack still holds four distinct readings. It is
    // a swap rather than a shuffle because both ends are known — this bay's old
    // value goes exactly where this bay's new value came from, and no third bay
    // moves.
    if (duplicate >= 0) all[duplicate] = seated;
    storeLineupColumns(all);
    setSockets(all.map(lineupColumnKey));
    // Seated, so there is nothing left in hand. `col` falls back to the bay,
    // which is now this column, and `dirty` goes false by arithmetic.
    setDraft(null);
  };

  /**
   * Move to another bay, abandoning whatever was in hand.
   *
   * **An edit belongs to the bay it was made in.** Carrying a draft across would
   * put a composed column into a socket the reader never opened it in; keeping
   * one per bay would make the rack carry state about four edits nobody has
   * committed, which is exactly what the deferral exists to take off it. The
   * cost is that a half-composed column is lost to a stray press on a
   * neighbouring tile, and the panel's own history is what argues for taking it:
   * nothing here has ever asked a reader to confirm.
   */
  const select = (index: number) => {
    setActive(index);
    setDraft(null);
  };

  /**
   * Open the panel on the card's own order, still inside the column last edited.
   *
   * The re-seed is what keeps the rack the tile strip it configures: an
   * arrangement earned by a sitting's presses should not outlive it, or a reader
   * coming back to the panel would find their bays in an order nothing on the
   * page explains. The selection follows its *column* across that one re-sort —
   * the same `findIndex` the write used to do on every press, which is right
   * here and was wrong there: this is the one moment the rack is allowed to
   * re-order, so it is the one moment an index has to chase what it points at.
   */
  const open = () => {
    // The *seated* column, not the draft: an unsaved edit does not outlive the
    // sitting it was made in, so what the re-opened panel follows is the column
    // the bay actually holds.
    const key = lineupColumnKey(seated);
    const landed = canonical.findIndex((c) => lineupColumnKey(c) === key);
    setSockets(null);
    setDraft(null);
    if (landed >= 0) setActive(landed);
    ref.current?.showModal();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className={triggerClassName}
      >
        {/* **`Edit columns`, and no count.** The key used to read `Columns 2`
            in the app rack, where a closed key was the only thing on screen
            saying how many of the four were in use. Four are always in use now,
            so a figure here would be a constant — and the panel is the only
            place that should describe its own state. */}
        Edit columns
      </button>

      <ColumnPanel
        dialogRef={ref}
        label="Card columns"
        title="Card columns"
        // **It reads the slot, not a budget.** With every bay always set there
        // is no count to move, and a static `4 of 4` would be dead weight in
        // the one place on this panel that can carry a live reading. What does
        // move is which slot you are inside.
        reading={`Bay ${bayNumber(bay)} / ${String(MAX_LINEUP_COLUMNS).padStart(2, "0")}`}
        copy="Pick a bay to set what it reads."
        wideCopy="Save seats it — a column another bay holds trades places."
        ktc={ktc}
      >
        {/* **A deep hole holding four raised parts**, and the depth is the
            argument: a tray holding controls is a surface, a tray holding
            parts is the absence of one. Four across at every width, which is
            the tile strip it configures — and always four, always full,
            which is how the shape states a budget it no longer has to
            describe in words. */}
        <ul
          className={`${CONSOLE_PART_TRAY} relative m-0 mt-3.5 grid list-none grid-cols-4 gap-2 rounded-2xl p-2`}
        >
          {/* **Keyed by socket, not by column**, which is the one place an
              index key is the right one: a bay is a hole in the rack and the
              thing a reader sees move is what is *in* it. Keyed by column,
              every press would unmount the socket it rewrote and mount a new
              one — and the 160ms lift, which is the only thing saying which
              of the four is selected, would never run. */}
          {bays.map((entry, i) => (
            <li key={i} className="min-w-0">
              <BayKey
                index={i}
                column={entry}
                active={i === bay}
                onSelect={() => select(i)}
              />
            </li>
          ))}
        </ul>

        <ColumnAxes
          chip={`Bay ${bayNumber(bay)}`}
          column={col}
          slots={slots}
          dirty={dirty}
          // The only place the exchange can be stated. A reader can guess what
          // seating a column does; nobody can guess that the bay already
          // holding it will take what this one held, and watching two tiles
          // change for one press without having been told is the panel doing
          // something behind them.
          saveTitle={
            !dirty
              ? "No change to save"
              : duplicate >= 0
                ? `Seat this column — bay ${bayNumber(duplicate)} takes what this one held`
                : `Seat this column in bay ${bayNumber(bay)}`
          }
          onChange={setDraft}
          onSave={save}
        />
      </ColumnPanel>
    </>
  );
}, columnsDialogPropsEqual);

/**
 * `memo`'s comparison, and the one prop it reads by value.
 *
 * Every prop is identity-stable at its call site — the columns are the store's
 * memo, the slots a `useMemo`, the trigger a constant — except `ktc`, which
 * a caller can spell `lineups?.ktc ?? []`: a fresh empty literal every render
 * until the lineups land, and the whole page renders once per line of the
 * leagues stream. Two empty boards are the same board, so that case is
 * answered by length rather than by identity; a board with rows in it is still
 * compared by identity, since the payload it came off is stable.
 */
function columnsDialogPropsEqual(
  prev: Readonly<ColumnsDialogProps>,
  next: Readonly<ColumnsDialogProps>,
): boolean {
  return (
    prev.columns === next.columns &&
    prev.slots === next.slots &&
    prev.triggerClassName === next.triggerClassName &&
    (prev.ktc === next.ktc || (prev.ktc.length === 0 && next.ktc.length === 0))
  );
}

/**
 * One socket on the rack: a milled part carrying what its bay reads.
 *
 * **The active bay is the only one lifted out of the tray**, on a riser and an
 * accent hairline with its lamp lit. That difference is what makes the rack read
 * as one-of-four rather than as a grid of four equals, and it is why the housing
 * below needs no heading naming which bay it edits beyond its own chip.
 *
 * Two stacked surfaces inside it — the `CONSOLE_WINDOW_LEDGE` grammar the league
 * card already uses — so the *words* sit on metal and only the *setting* is on
 * glass. The bay number and its lamp belong to the part; what the column reads
 * belongs to the reading.
 *
 * The second line is the setting (`Auto · Auto`) on a KeepTradeCut bay and the
 * scope elsewhere, then the position list where there is one — which is the same
 * pair the card's tile prints, except that the tile prints what the setting
 * *resolved to* for its own league (`Dyn·SF`). A panel that has never seen a
 * league cannot name a market for one, and `Auto` is the honest word for a rule.
 */
function BayKey({
  index,
  column: col,
  active,
  onSelect,
}: {
  index: number;
  column: LineupColumn;
  active: boolean;
  onSelect: () => void;
}) {
  const words = LINEUP_METRIC_LABELS[col.metric];
  // **Two units, switched by the cascade rather than by state.** A bay is 122px
  // at the dialog's desktop width and ~72px at 390, and inside the second one
  // there are ~58px for this line — where `Draft cap`, `KTC start` and `KTC
  // picks` all measure 61.5px at `--fs-10`. The long form is the card tile's
  // own `unit`, which is what makes the bay read as the tile it configures; the
  // short form is the *value* axis the track below sets, which is the same word
  // one grain coarser and cannot clip. The metric's full name is on the housing
  // below either way, and in this key's accessible name.
  const short = COLUMN_VALUE_LABELS[metricAxes(col.metric).value];
  const second = columnSetting(col);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      // The name is the whole bay, spoken: a button reading "KTC" in a row of
      // four numbered sockets says nothing about which socket it is.
      aria-label={`Bay ${bayNumber(index)}, ${words.column}${second ? `, ${second}` : ""}`}
      className={
        `${CONSOLE_BILLET_FACE} lab-anim relative flex w-full flex-col rounded-[0.6875rem] text-left ` +
        "transition-[transform,box-shadow] duration-[160ms] " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
        // Composed whole, never layered: `--billet-shadow` is the chamfer and
        // the riser is what stands the part out of the hole, and a shadow list
        // is atomic — a second `shadow-[…]` would replace the chamfer rather
        // than sit under it. `motion-safe:` on the lift because `.lab-anim`
        // clears the transition and not the transform.
        (active
          ? "shadow-[var(--billet-shadow),0_5px_0_rgba(0,0,0,0.72),0_14px_22px_-8px_rgba(0,0,0,0.95),0_0_28px_-6px_var(--accent-glow)] motion-safe:-translate-y-0.5"
          : "shadow-[var(--billet-shadow),0_3px_0_rgba(0,0,0,0.7),0_9px_16px_-7px_rgba(0,0,0,0.95)]")
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--billet-grain)]"
      />
      {/* The accent hairline, as a child rather than an `outline`: it has to
          paint over the ledge and the glass, and it must not be the thing a
          focus ring then has to argue with. */}
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-px z-[1] rounded-[0.625rem] border border-active/50"
        />
      )}
      <span
        aria-hidden
        className={`${CONSOLE_WINDOW_LEDGE} relative flex w-full items-center justify-between gap-1 px-[0.4375rem] py-1`}
      >
        <span className="font-mono text-[length:var(--fs-8-5)] tracking-[0.16em] text-[color:var(--billet-label)]">
          {bayNumber(index)}
        </span>
        {/* Resting is a dark unlit slot rather than a missing element: a lamp
            that disappeared would say the socket had lost a part. */}
        <span
          className={`size-[0.3125rem] shrink-0 rounded-full ${
            active
              ? "bg-active shadow-[0_0_7px_var(--accent-glow)]"
              : "bg-black/40 shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]"
          }`}
        />
      </span>
      <span
        aria-hidden
        className={`${CONSOLE_GLASS} flex w-full flex-col gap-0.5 px-[0.4375rem] pb-[0.5625rem] pt-2`}
      >
        <Scanlines />
        <span
          className={`relative truncate font-mono text-[length:var(--fs-10)] uppercase leading-[1.15] sm:text-[length:var(--fs-11)] sm:tracking-[0.02em] ${
            active ? "text-readout-line" : "text-readout-label"
          }`}
        >
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{words.unit}</span>
        </span>
        {/* The height is reserved rather than left to the content: a rack of
            four with one setting missing would read as four parts at four
            heights. */}
        <span
          className={`relative min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-8-5)] uppercase leading-[1.15] sm:text-[length:var(--fs-9)] sm:tracking-[0.04em] ${
            active
              ? "text-readout [text-shadow:var(--readout-text-glow)]"
              : "text-readout-muted"
          }`}
        >
          {second}
        </span>
      </span>
    </button>
  );
}

/** `01`–`04`. Two digits because a bay is a socket on a rack, not a list item. */
function bayNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}
