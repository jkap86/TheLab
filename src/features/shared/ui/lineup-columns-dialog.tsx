"use client";

import { useRef, useState } from "react";

import type {
  KtcBoardChoice,
  KtcLineupChoice,
  LineupColumn,
  LineupPosition,
  LineupSlot,
  ManagerLineupsPayload,
} from "@/shared/contract";
import {
  isKtcMetric,
  lineupColumnKey,
  readsQbBoard,
} from "@/shared/ktc/columns";

// Relative rather than through this folder's own barrel — the rule
// `league-filters-dialog.tsx` beside it already lives by: a module inside
// `features/shared` reaches its siblings directly.
import {
  CONSOLE_BILLET_FACE,
  CONSOLE_GLASS,
  CONSOLE_PART_TRAY,
  CONSOLE_KEY_PILL,
  CONSOLE_KEY_PILL_BARE,
  CONSOLE_WINDOW_LEDGE,
} from "../console-chrome";
import {
  adpBoardLabel,
  arrangeLineupColumns,
  cellGapReason,
  column,
  COLUMN_SCOPE_LABELS,
  COLUMN_SCOPES,
  COLUMN_VALUE_LABELS,
  COLUMN_VALUES,
  IDP_LINEUP_POSITIONS,
  ktcChoiceLabel,
  LINEUP_METRIC_LABELS,
  LINEUP_POSITION_LABELS,
  LINEUP_POSITIONS,
  LINEUP_SLOT_GROUPS,
  LINEUP_SLOT_LABELS,
  LINEUP_SLOTS,
  MAX_LINEUP_COLUMNS,
  metricAt,
  metricAxes,
  narrowingClause,
  normalizeLineupColumns,
  positionGapReason,
  positionsLabel,
  slotGapReason,
  slotsLabel,
  storeLineupColumns,
  type ColumnScope,
  type ColumnValue,
  type SlotGroup,
} from "../lineup-columns";
import { KtcBoardKeys, KtcLineupKeys, SwitchTrack } from "./ktc-board-keys";
import { Scanlines } from "./card-plate";

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
 */
export function LineupColumnsDialog({
  columns,
  ktc,
  slots = [],
  triggerClassName = `${CONSOLE_KEY_PILL} inline-flex items-center border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`,
}: {
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
}) {
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
  const axes = metricAxes(col.metric);
  const words = LINEUP_METRIC_LABELS[col.metric];
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

  /**
   * The column a press would write: the axis pressed, and **every other axis
   * carried over**.
   *
   * That is what makes the grid's holes visible rather than silently routed
   * around: sitting on `Proj · Starters` and pressing `Capital` gives
   * `Capital · Starters`, not `Capital · Roster`, and sitting on `All` and
   * pressing `Proj` has no metric behind it — so the key greys with its reason
   * instead of quietly moving the scope and answering a question nobody asked.
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
   * **One claim now, where it used to be two.** The pairing has no metric behind
   * it at all — `cellGapReason`, the grid's one remaining hole — and that is a
   * reading which cannot exist. The other claim, that a sibling bay already
   * holds the column a press would write, is gone with the collision rule: a
   * duplicate is resolved by exchange on `Save` rather than refused here, so
   * greying it would be refusing a press that has an answer. A grey with no
   * title is still a key a reader cannot find out anything about, which is what
   * this panel's disable-rather-than-correct rule cannot afford.
   */
  const why = (patch: Patch): string | null =>
    candidate(patch)
      ? null
      : cellGapReason(patch.value ?? axes.value, patch.scope ?? axes.scope);

  /** Compose a press into the draft, or refuse it — which the key that made it
   * is already grey for. Nothing on the rack moves; `Save` is what seats it. */
  const press = (patch: Patch) => {
    const next = candidate(patch);
    if (next && !why(patch)) setDraft(next);
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
   * nine are off wholesale on a `KTC · Picks` bay (`positionGapReason`), and
   * that is the only reason left: the collision rule this also used to ask is
   * gone, a duplicate being a save to resolve rather than a press to refuse.
   *
   * It stays **per key** rather than becoming the whole-axis `offReason` the
   * three tracks above it take, and the difference is `All`: it is still live on
   * a picks bay, because the absence of a narrowing is a state that column
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
   * `All` unlit with no key lit either — a narrowing on screen in the bay's own
   * second line that the control cannot name. `normalizeLineupSlots` keeps such
   * a column valid deliberately (see its note), so the picker has to be able to
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

      <dialog
        ref={ref}
        // Closing on a backdrop click: the dialog element itself is only ever
        // the click target when the click landed outside the panel.
        onClick={(e) => {
          if (e.target === e.currentTarget) ref.current?.close();
        }}
        aria-label="Card columns"
        // 560px, which is what ten position keys need to keep their legends —
        // a 448px case gave `DEF` three characters.
        //
        // It still scrolls rather than clipping. The panel fits the UA's
        // `max-height` at both widths, but a `<dialog>` that hides its overflow
        // puts *Done* somewhere no scroll can reach the day a reader's own type
        // scale or a long metric name pushes it over — which is the state one
        // rewrite of this panel already found it in. `overflow-y-auto` still
        // clips to the radius, which is what the hidden was doing the rest of
        // its work for.
        //
        // **The shadow replaces `--panel-shadow` rather than joining it**: it is
        // the billet chamfer read at case scale — bright top, dark underside,
        // lit left, shaded right — over a two-stage cast, and it is written as
        // one list because a shadow list is atomic. A second `shadow-[…]` beside
        // it would not add four insets, it would replace them, and which one
        // won would be Tailwind's emit order.
        className={
          "lab-scroll m-auto max-h-[calc(100dvh-2rem)] w-[min(35rem,calc(100vw-2rem))] " +
          "overflow-y-auto overscroll-contain rounded-[1.75rem] bg-background " +
          "bg-[image:var(--panel-bg)] p-0 text-foreground backdrop:bg-black/60 " +
          "shadow-[inset_0_2px_0_rgba(255,255,255,0.22),inset_0_-2px_0_rgba(0,0,0,0.85),inset_2px_0_0_rgba(255,255,255,0.05),inset_-2px_0_0_rgba(0,0,0,0.55),0_2px_0_rgba(255,255,255,0.05),0_26px_44px_-22px_rgba(0,0,0,0.9),0_70px_130px_-46px_#000]"
        }
      >
        {/* The ring and the grain wrap the *content* rather than the dialog's
            own box, which is the same call the panel grain has always made
            here: an `inset` overlay on a scroll container is positioned against
            the padding box at its unscrolled origin, so on a scrolled panel it
            would end at the fold. Wrapping the content, it frames whatever the
            case actually holds. */}
        <div className="relative">
          {/* **A machined bezel ring, as a child rather than a second border.**
              The case's own chamfer is four insets of one atomic shadow list, so
              a ring written as a border would have to fight it for one colour;
              a child cannot. It is the reason every lit window carries its
              scanlines as a child too. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-1.5 z-10 rounded-[1.375rem] border border-[rgba(255,255,255,0.055)] shadow-[inset_0_1px_0_rgba(0,0,0,0.5)]"
          />

          {/* **The header band is a part bolted on, not a coloured region**, and
              the cast under it is the whole of what says so — the chamfer, a
              hard dark edge, then a shadow thrown onto the body below. Above the
              body in stacking order so that cast lands on it. Composed whole for
              the case's reason: `CONSOLE_BILLET` carries `--billet-shadow` on
              its own, and a second `shadow-[…]` beside it replaces rather than
              extends, so what is reached for here is the face alone. */}
          <div
            className={`${CONSOLE_BILLET_FACE} relative z-[2] px-5 py-[0.9375rem] shadow-[var(--billet-shadow),0_2px_0_rgba(0,0,0,0.85),0_10px_20px_-8px_rgba(0,0,0,0.9)]`}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--billet-grain)]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--billet-specular)]"
            />
            {/* The specular hairline along the band's own top edge: the light
                catching a milled corner, inset either side so it reads as a
                chamfer rather than as a rule drawn across the panel. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-[6%] top-0 h-px bg-[image:linear-gradient(to_right,transparent,rgba(255,255,255,0.65),transparent)]"
            />
            <div className="relative flex items-center justify-between gap-3.5">
              {/* Ink on metal, not the readout's mint: a label stamped into a
                  machined face is the metal's own colour lightened, and drawing
                  it in mint would say the band was a window. */}
              <h2 className="m-0 font-display text-[length:var(--fs-15)] font-semibold uppercase tracking-[0.13em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
                Card columns
              </h2>
              {/* **It reads the slot, not a budget.** With every bay always set
                  there is no count to move, and a static `4 of 4` would be dead
                  weight in the one place on this panel that can carry a live
                  reading. What does move is which slot you are inside — so this
                  is where `aria-live` belongs, and it is a lit window rather
                  than loose mono because a reading is drawn on glass. */}
              <span
                className={`${CONSOLE_GLASS} inline-flex shrink-0 items-center gap-[0.4375rem] rounded-lg border border-black/70 px-2.5 py-[0.3125rem]`}
              >
                <Scanlines />
                <span
                  aria-hidden
                  className="relative size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_6px_var(--accent-glow)]"
                />
                <span
                  aria-live="polite"
                  className="relative font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]"
                >
                  Bay {bayNumber(bay)} / {String(MAX_LINEUP_COLUMNS).padStart(2, "0")}
                </span>
              </span>
            </div>
          </div>

          <div className="relative px-[1.125rem] pb-[1.125rem] pt-4">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
            />
            <p className="relative m-0 font-mono text-[length:var(--fs-11)] leading-[1.5] text-foreground/62">
              Pick a bay to set what it reads.
              <span className="hidden sm:inline">
                {" "}
                Save seats it — a column another bay holds trades places.
              </span>
            </p>

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

            {/* The selected bay's own axes, in one machined housing.
                **The accent is a hairline ring inside the shadow list rather
                than a `border`**, so the four chamfer insets and the accent
                cannot fight over one border colour — the emit-order flip this
                console's constants are split apart to avoid, one property
                over. */}
            <div className="relative mt-3.5 overflow-hidden rounded-[1.0625rem] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.2),inset_0_-1.5px_0_rgba(0,0,0,0.8),inset_1px_0_0_rgba(255,255,255,0.05),inset_-1px_0_0_rgba(0,0,0,0.5),0_0_0_1px_rgba(0,255,229,0.2),0_3px_0_rgba(0,0,0,0.55),0_14px_26px_-12px_rgba(0,0,0,0.9),0_0_34px_-18px_var(--accent-glow)]">
              {/* The housing's own header ledge, above its body in stacking
                  order so its cast lands on it — the header band's argument one
                  grain smaller. */}
              <div
                // The ledge's *face* alone rather than `CONSOLE_WINDOW_LEDGE`,
                // on `CONSOLE_BILLET_FACE`'s rule: that constant carries
                // `--window-ledge-shadow` and a shadow list is atomic, so a
                // second `shadow-[…]` beside it replaces the chamfer rather than
                // casting under it — and which wins is Tailwind's emit order.
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
                    Bay {bayNumber(bay)}
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-15)] font-semibold tracking-[-0.005em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
                  {words.column}
                </span>
                {/* **`Save` stands where `Clear`, and then the `Editing`
                    caption, used to.** The housing is what a press edits, so the
                    press that seats it belongs on the same part — and it is
                    always a key, never appearing, on the same no-fluctuation
                    rule as the three tracks below: dark and unpressable with
                    nothing to seat rather than absent, so the ledge does not
                    change width the moment a reader touches an axis.

                    Its title is the only place the exchange can be stated. A
                    reader can guess what seating a column does; nobody can guess
                    that the bay already holding it will take what this one held,
                    and watching two tiles change for one press without having
                    been told is the panel doing something behind them.

                    `aria-disabled` rather than the attribute, because this
                    toggles under a reader's own focus: a key that is the target
                    of a press and then goes `disabled` blurs to `<body>`, which
                    on a modal is the one place a keyboard reader cannot afford
                    to be sent. The guard is `save`'s own `dirty` check. */}
                <button
                  type="button"
                  onClick={save}
                  aria-disabled={!dirty}
                  title={
                    !dirty
                      ? "No change to save"
                      : duplicate >= 0
                        ? `Seat this column — bay ${bayNumber(duplicate)} takes what this one held`
                        : `Seat this column in bay ${bayNumber(bay)}`
                  }
                  className={
                    // The bare pill, because this key is `--fs-9` where the
                    // shell is `--fs-11` — both arbitrary values, so appending
                    // one to the other is decided by Tailwind's emit order
                    // rather than by the class attribute. See
                    // `CONSOLE_KEY_PILL_BARE`.
                    `${CONSOLE_KEY_PILL_BARE} px-[0.6875rem] py-1 text-[length:var(--fs-9)] tracking-[0.14em] ` +
                    (dirty
                      ? // Composed whole rather than layered: a shadow list is
                        // atomic, so a riser written beside a resting inset
                        // would replace it rather than add to it.
                        "border-active/60 bg-[image:var(--key-metal)] text-readout [text-shadow:var(--readout-text-glow)] " +
                        "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2px_0_rgba(0,0,0,0.7),0_7px_12px_-6px_rgba(0,0,0,0.95),0_0_22px_-6px_var(--accent-glow)]"
                      : "cursor-not-allowed border-transparent bg-[color:var(--recess-bg)] text-foreground/34 " +
                        "shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]")
                  }
                >
                  Save
                </button>
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

                {/* **The Scope axis's own second line.** A seat is a thing only
                    a starting lineup has, so off the `starters` scope the whole
                    track goes out of force — and it keeps its place, because
                    `Starters` unlit one row above is what says *why* it is dim
                    and a row that vanished under a press would take the answer
                    with it.

                    Omitted only where the account offers no seats at all, which
                    is not that fluctuation: the vocabulary is a prop, so it
                    cannot move under a press, and a track holding `All` alone is
                    a switch with one detent. */}
                {offeredSlots.length > 0 && (
                  <SwitchTrack
                    label="Slot"
                    legend
                    options={slotKeys}
                    // Out of force lights nothing — not even `All`, which would
                    // read as a narrowing this column is in force on.
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
                    // The one track whose vocabulary is the reader's own
                    // leagues, and therefore the one that can outgrow its row.
                    // See {@link KEYS_PER_TRACK} for the bound and
                    // {@link SwitchTrack.wrap} for what crossing it buys.
                    wrap={slotKeys.length > KEYS_PER_TRACK}
                  />
                )}

                {/* **These two used to mount only on the columns that read
                    them, and that was the fluctuation.** Pressing `Capital` on a
                    KeepTradeCut bay took the Market row out from under the
                    cursor and resized the case mid-sitting, which is the one
                    thing a panel a reader is pressing into must not do. They
                    keep their places and go out of force instead, with the
                    reason in every key's title and the legend dimmed with them —
                    and the unlit key one or two rows above is what explains each
                    dim.

                    They are still two tracks rather than a pair, because the two
                    axes are read by different metrics. A *market* is
                    KeepTradeCut's own. A *QB board* is a fact about how the
                    league starts quarterbacks and both priced valuations split
                    on it, so the three capital bays read it too — which is the
                    whole of what a reader gets from that axis: their roster's
                    draft capital priced on the superflex board while they sit in
                    a 1QB league. A projection reads neither. */}
                <KtcBoardKeys
                  board={col.format}
                  onChange={(format) => press({ format })}
                  size="row"
                  legend
                  className=""
                  offReason={
                    isKtcMetric(col.metric) ? undefined : MARKET_OFF
                  }
                  unavailable={(format) => why({ format })}
                />
                <KtcLineupKeys
                  lineup={col.lineup}
                  onChange={(lineup) => press({ lineup })}
                  size="row"
                  legend
                  className=""
                  offReason={
                    readsQbBoard(col.metric) ? undefined : QB_BOARD_OFF
                  }
                  unavailable={(lineup) => why({ lineup })}
                />

                {/* **The milled cut is copy, not rhythm.** Position *narrows*
                    the two axes above it rather than being a third of them, and
                    the cut is the only thing on the panel that says so. */}
                <span
                  aria-hidden
                  className="h-px bg-[image:var(--groove)] shadow-[0_1px_0_rgba(255,255,255,0.05)]"
                />

                <SwitchTrack
                  label="Position"
                  legend
                  options={POSITION_KEYS}
                  // The caller maps its own state into the track's vocabulary,
                  // which is what lets `All` be a key here and the absence of a
                  // narrowing everywhere else — the track lights what it is
                  // handed and this owns the toggle.
                  value={col.positions.length === 0 ? ALL_ONLY : col.positions}
                  onChange={(key) => press({ positions: toggled(key) })}
                  labels={POSITION_KEY_LABELS}
                  className=""
                  size="row"
                  unavailable={positionOff}
                  // **`K` and `DEF` sit with the four skill positions and the
                  // three individual-defender families sit apart from both**,
                  // because those are the groups a league actually starts. Read
                  // off the vocabulary rather than spelled as indices, so a
                  // position the solver learns lands on the right side of the
                  // cut instead of shifting a number nobody would think to
                  // update.
                  divider={(key) =>
                    key === LINEUP_POSITIONS[0] || key === IDP_LINEUP_POSITIONS[0]
                  }
                />

                {/* **What the bay reads, in words**, composed on every press
                    from the metric's own sentence, the board clause and the
                    position list. It is the one thing the rack cannot say: a bay
                    is four characters of unit over a board pair, and
                    `KTC · Dyn · SF` does not tell a reader the number includes
                    the picks. */}
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
                  {/* **Three lines reserved, not two.** A priced column
                      appends a board clause *on top of* a narrowing — "Draft
                      capital off ADP — the starters only. Off each league's own
                      draft board. In the FLEX and superflex seats only." — which
                      is three lines in this window's ~386px measure, so
                      `Proj ↔ Capital` moved the case 17.7px under the reader's
                      finger. Three is the longest a *toggle* can produce; a
                      reader who lights eight seats and three positions still
                      grows it, which is a sentence they built rather than one a
                      press handed them.

                      **Four below `sm`, and that is a measurement rather than a
                      margin.** The label stacks above the paragraph there
                      instead of standing beside it, so the window is the
                      panel's own ~320px rather than ~386, and the same sentence
                      takes a fourth line — measured, the case moved 18px on the
                      `Proj ↔ Capital` press at 390 while holding still at 1280.
                      A rule that holds at one width and not the other is half a
                      rule, and a phone is where a case shifting under a thumb
                      matters most. */}
                  <p className="relative m-0 min-h-[5.8em] min-w-0 flex-1 font-mono text-[length:var(--fs-10-5)] leading-[1.45] text-readout-line text-pretty sm:min-h-[4.35em]">
                    {reads(col)}
                  </p>
                </div>
              </div>
            </div>

            <div className="relative mt-[0.9375rem] flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
              {/* What was read and when — silent where nothing could be, since
                  the KTC columns already say so with their em dashes. */}
              {ktc.length > 0 && (
                <p className="m-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/55">
                  KTC
                  {ktc.map((board) => (
                    <span key={board.format}>
                      {" · "}
                      {board.format === "dynasty" ? "dyn" : "red"}{" "}
                      {board.updated_at ? scrapedAt(board.updated_at) : "—"}
                    </span>
                  ))}
                </p>
              )}
              {/* The highest object in the stack, and it applies nothing: every
                  press has already written. */}
              <button
                type="button"
                onClick={() => ref.current?.close()}
                className="lab-anim ml-auto inline-flex shrink-0 items-center rounded-xl border border-active/60 bg-[image:var(--key-metal)] px-[1.625rem] py-2.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-readout [text-shadow:var(--readout-text-glow)] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.5),0_5px_0_rgba(0,0,0,0.7),0_14px_24px_-10px_rgba(0,0,0,0.95),0_0_32px_-6px_var(--accent-glow)] transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 motion-safe:active:translate-y-0.5"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * One axis of a press, with the rest of the column carried over.
 *
 * A partial rather than four functions, because the *rule* is one — change one
 * axis, keep the others — and spelling it per axis is four chances for one of
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
  const second = baySetting(col);

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

/**
 * A bay's second line: what the column is *set* to, then what it narrows to —
 * the seats first and the players in them second, which is the order the
 * `Reads` sentence puts them in and the order they compose in.
 *
 * One spelling, because it is both the visible line and the button's accessible
 * name — two would be a rack that says one thing and announces another.
 */
function baySetting(col: LineupColumn): string {
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
  // spends a third of a 58px line saying it twice. On a KeepTradeCut bay there
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

/** `01`–`04`. Two digits because a bay is a socket on a rack, not a list item. */
function bayNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/**
 * The bay's whole reading: the metric's own sentence, its board clause, and its
 * position list.
 *
 * Three clauses composed rather than one string per column, which is what keeps
 * ten metrics × nine pricings × every seat and position set expressible without
 * a table nobody could keep true.
 */
function reads(col: LineupColumn): string {
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
  // alone — and it is spelled out even on `auto`, where the bay's own line
  // stays silent: the window is where there is room to say what a rule means,
  // and "each league's own draft board" is exactly the thing a reader who has
  // never pressed this track would otherwise have to infer.
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
 * everything else in this dialog, so there is no server/client clock to
 * disagree.
 */
function scrapedAt(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
