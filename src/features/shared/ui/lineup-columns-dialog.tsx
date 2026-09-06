"use client";

import { useRef, useState } from "react";

import type {
  KtcBoardChoice,
  KtcLineupChoice,
  LineupColumn,
  LineupPosition,
  ManagerLineupsPayload,
} from "@/shared/contract";
import { isKtcMetric, lineupColumnKey } from "@/shared/ktc/columns";

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
  MAX_LINEUP_COLUMNS,
  metricAt,
  metricAxes,
  normalizeLineupColumns,
  positionGapReason,
  positionsClause,
  positionsLabel,
  storeLineupColumns,
  type ColumnScope,
  type ColumnValue,
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
 * **The one bound that survives is the collision rule, and it does more work
 * than it used to.** Every slot being occupied means every press is checked
 * against three siblings rather than against however many happened to be set.
 * It runs against the **whole column** a press would write — metric, market, QB
 * board and position set — never against the metric alone, because two bays
 * holding one metric on two boards is the comparison a dynasty reader opens this
 * panel to make.
 *
 * **The bay is the preview.** An earlier direction drew a preview tile under the
 * composer; here the selected bay updates on every press and is already drawn as
 * the tile it configures, so a second copy would be the same reading twice. What
 * is kept from that direction is the `Reads` line: the composed column stated in
 * words, on lit glass, under the tracks.
 *
 * A press writes immediately rather than staging an "apply": the cards update
 * live behind the dialog, and there is no draft state to reconcile with a change
 * from another tab.
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
  triggerClassName = `${CONSOLE_KEY_PILL} inline-flex items-center border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`,
}: {
  /** The chosen columns, already in canonical order — see `useLineupColumns`. */
  columns: readonly LineupColumn[];
  /** Which markets answered and when each was scraped; empty when none could. */
  ktc: ManagerLineupsPayload["ktc"];
  /** The trigger's shape — see `LeagueFiltersDialog`, which is shaped the same way. */
  triggerClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /**
   * Which bay is being edited.
   *
   * A bay *index*, because a bay is a socket on a rack rather than a column.
   *
   * **But the selection is a set rendered in canonical order, so an edit
   * renumbers the sockets**, and an index held across that re-sort points at
   * whatever landed there. Switching bay 01 to KeepTradeCut moves it to bay 04,
   * and an index left at 0 would leave the panel editing the column that slid
   * up into its place — the reader pressing a key and watching a different
   * column answer. So every write goes through {@link write}, which asks the
   * store where the column it just wrote ended up.
   *
   * Local and unpersisted, like the tab it replaced: which bay you were last
   * inside is a fact about this sitting.
   */
  const [active, setActive] = useState(0);

  /**
   * The rack's four bays.
   *
   * Folded again here rather than trusted, and it is one idempotent call: every
   * line below indexes a bay without a guard, and the state that would break
   * them — a selection of three — is one `normalizeLineupColumns` cannot
   * produce. `MAX_LINEUP_COLUMNS` means *exactly* four for this reason.
   */
  const bays = normalizeLineupColumns(columns);
  const bay = Math.min(Math.max(active, 0), bays.length - 1);
  const col = bays[bay];
  const axes = metricAxes(col.metric);
  const words = LINEUP_METRIC_LABELS[col.metric];

  /** Every other bay's key, so this bay's tracks can grey what they hold. */
  const takenElsewhere = new Set(
    bays.filter((_, i) => i !== bay).map(lineupColumnKey),
  );

  /**
   * Persist a selection and keep the panel on the column it just wrote.
   *
   * `normalizeLineupColumns` is the same fold the store applies, so the index
   * found here is the one the next render will number the bay by — asking the
   * store what it did rather than predicting it is what keeps the two from
   * disagreeing the day the sort changes.
   */
  const write = (next: LineupColumn) => {
    const all = bays.map((c, i) => (i === bay ? next : c));
    storeLineupColumns(all);
    const key = lineupColumnKey(next);
    const landed = normalizeLineupColumns(all).findIndex(
      (c) => lineupColumnKey(c) === key,
    );
    if (landed >= 0) setActive(landed);
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
        )
      : null;
  };

  /**
   * Why a press is off, or null where it can be made.
   *
   * Two claims, and a key that is off says which: the pairing has no metric
   * behind it at all (`cellGapReason` — the grid's two holes), or the column it
   * would write is already in another bay. A grey with no title is a key a
   * reader cannot find out anything about, which is the one thing this panel's
   * disable-rather-than-correct rule cannot afford.
   */
  const why = (patch: Patch): string | null => {
    const next = candidate(patch);
    if (!next) {
      return cellGapReason(patch.value ?? axes.value, patch.scope ?? axes.scope);
    }
    return takenElsewhere.has(lineupColumnKey(next)) ? BAY_HOLDS : null;
  };

  /** Write a press, or refuse it — which the key that made it is already grey for. */
  const press = (patch: Patch) => {
    const next = candidate(patch);
    if (next && !why(patch)) write(next);
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

  /**
   * Why a position key is off.
   *
   * `All` is never off — it is the absence of a narrowing rather than a
   * narrowing to everything, so there is no column it could fail to write. The
   * nine are off wholesale on a `KTC · Picks` bay (`positionGapReason`), and
   * otherwise on the same collision rule as every other axis. **Including the
   * lit ones**, which is where the position track parts company with the four
   * single-select ones above it: pressing a lit key there rewrites the same
   * column, where pressing a lit key here *removes* a position and is therefore
   * a different column that a sibling bay may already hold.
   */
  const positionOff = (key: PositionKey): string | null =>
    key === "all"
      ? null
      : (positionGapReason(axes.scope) ?? why({ positions: toggled(key) }));

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
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
                The card updates as you press.
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
                    onSelect={() => setActive(i)}
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
                {/* **This is where `Clear` used to be.** A stamped caption
                    rather than a key: with every bay always set there is nothing
                    to clear to, and the word says what the housing is for
                    instead of offering a press that would have nowhere to
                    land. */}
                <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)]">
                  Editing
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

                {/* Two tracks a column with no market cannot answer, so they are
                    absent rather than greyed: nothing here is dimmed for being
                    inapplicable to a column the reader is not editing. */}
                {isKtcMetric(col.metric) && (
                  <>
                    <KtcBoardKeys
                      board={col.format}
                      onChange={(format) => press({ format })}
                      size="row"
                      legend
                      className=""
                      unavailable={(format) => why({ format })}
                    />
                    <KtcLineupKeys
                      lineup={col.lineup}
                      onChange={(lineup) => press({ lineup })}
                      size="row"
                      legend
                      className=""
                      unavailable={(lineup) => why({ lineup })}
                    />
                  </>
                )}

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
                  <p className="relative m-0 min-w-0 flex-1 font-mono text-[length:var(--fs-10-5)] leading-[1.45] text-readout-line text-pretty">
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

/** Why an axis key is off: a sibling bay already holds the column it would make. */
const BAY_HOLDS = "Another bay is on this column";

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
        "transition-[transform,box-shadow] duration-150 " +
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
 * A bay's second line: what the column is *set* to, then what it narrows to.
 *
 * One spelling, because it is both the visible line and the button's accessible
 * name — two would be a rack that says one thing and announces another.
 */
function baySetting(col: LineupColumn): string {
  const setting = isKtcMetric(col.metric)
    ? ktcChoiceLabel(col)
    : LINEUP_METRIC_LABELS[col.metric].scope;
  const narrowed = positionsLabel(col.positions);
  if (!narrowed) return setting;
  return setting ? `${setting} · ${narrowed}` : narrowed;
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
 * nine metrics × nine pricings × every position set expressible without a table
 * nobody could keep true.
 */
function reads(col: LineupColumn): string {
  const words = LINEUP_METRIC_LABELS[col.metric];
  const board = isKtcMetric(col.metric) ? ` ${boardClause(col)}` : "";
  return `${words.option}${board}${positionsClause(col.positions)}`;
}

/**
 * The market clause a KeepTradeCut column's sentence ends with.
 *
 * Both axes on `auto` collapse to one short phrase rather than spelling the
 * rule twice — "on each league's own market, at each league's own prices" says
 * in two lines what "its own board" says in three words.
 */
function boardClause(col: LineupColumn): string {
  if (col.format === "auto" && col.lineup === "auto") {
    return "On each league's own board.";
  }
  const market =
    col.format === "auto"
      ? "each league's own market"
      : `the ${col.format} board`;
  const lineup =
    col.lineup === "auto"
      ? "each league's own prices"
      : col.lineup === "sf"
        ? "superflex prices"
        : "1QB prices";
  return `On ${market}, at ${lineup}.`;
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
