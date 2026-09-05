"use client";

import { useRef, useState } from "react";

import type {
  LineupColumn,
  LineupMetricId,
  ManagerLineupsPayload,
} from "@/shared/contract";
import {
  KTC_BOARD_CHOICES,
  KTC_LINEUP_CHOICES,
} from "@/shared/ktc/board-choice";
import { isKtcMetric, lineupColumnKey } from "@/shared/ktc/columns";

// Relative rather than through this folder's own barrel — the rule
// `league-filters-dialog.tsx` beside it already lives by: a module inside
// `features/shared` reaches its siblings directly.
import {
  CONSOLE_KEY_BLOCK,
  CONSOLE_KEY_PILL,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
} from "../console-chrome";
import {
  cellGapReason,
  column,
  COLUMN_SCOPE_LABELS,
  COLUMN_SCOPES,
  COLUMN_VALUE_LABELS,
  COLUMN_VALUES,
  ktcChoiceLabel,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  MAX_LINEUP_COLUMNS,
  metricAt,
  metricAxes,
  normalizeLineupColumns,
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
 * the chosen ones repeating that sentence inside their bay. Twelve sentences
 * in a 448px column measured 1218px at desktop and 1352px at 390, against a
 * `<dialog>`'s own budget of about 812px: it scrolled, and *Done* sat well
 * below the fold. Selecting a bay is the only navigation now, the tracks under
 * the rack are that bay's own axes, and the panel is 620px / 693px.
 *
 * **The nine metric keys are gone because the nine metrics were never nine
 * questions.** They are a *value* crossed with a *scope* — see `METRIC_AXES`
 * in `lineup-columns.ts`, which is where that grid lives and where the two
 * holes in it are argued. A reader picks the two, and the pairing that has no
 * metric behind it is greyed with its reason rather than being absent, which is
 * what the flat list was hiding.
 *
 * **The bay is the preview.** An earlier direction drew a preview tile under
 * the composer, because a stepped composer builds a column that does not exist
 * yet; here the selected bay updates on every press and is already drawn as the
 * tile it configures, so a second copy would be the same reading twice. What is
 * kept from that direction is the `Reads` line: the composed column stated in
 * words, on lit glass, under the tracks.
 *
 * A press writes immediately rather than staging an "apply": the cards update
 * live behind the dialog, and there is no draft state to reconcile with a
 * change from another tab. The bounds are still enforced by disabling rather
 * than refusing — the last bay standing cannot be cleared, and an option a
 * sibling bay already holds is greyed rather than corrected.
 *
 * **The KeepTradeCut board lives in the bay, not in this panel's foot.** A
 * global board key is contradicted by a column that names its own: the market
 * is not a property of the page, it is what one of these four columns *means*,
 * and putting it in the bay is what lets two bays hold one metric on two
 * boards — the comparison a dynasty reader opens this panel to make. What
 * survives of the old foot is the scrape line: these are someone else's numbers
 * on a fifteen-minute cache, and anything showing them should be able to say
 * how old they are.
 *
 * `storeKtcBoard` / `useKtcBoard` stay where they are — the trades board is a
 * different call site with a different argument (see that route on why one page
 * sends the choice and the other does not), and only the manager page's columns
 * stop reading a page-wide board.
 *
 * **A `Position` axis is deliberately not here.** The design offers a third
 * track — `All / QB / RB / WR / TE / IDP` — and it is the one thing in it that
 * is a *feature* rather than a re-presentation: there is no position axis on
 * `LineupColumn`, no per-position total on `LeagueTeam`, nothing in
 * `lineupMetricTotals` that groups by position, and no rank for one in the
 * route. Building the track without the four seams behind it would be a control
 * that reads a column nobody can compute. It is flagged back rather than
 * guessed at; the words themselves are not new when it arrives (`SLOT_GROUPS`
 * in `league-filters/defaults.ts` is derived from the solver's own tables).
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
   * A bay *index*, because a bay is a socket on a rack rather than a column —
   * clearing one leaves the reader looking at the socket they emptied, showing
   * its `Add` state, which is the reading they are after.
   *
   * **But the selection is a set rendered in canonical order, so an edit
   * renumbers the sockets**, and an index held across that re-sort points at
   * whatever landed there. Adding `Proj · Bench` from bay 04 sorts it to bay 02
   * and would leave the panel editing bay 04's *old* neighbour — the reader
   * pressing a key and watching a different column answer. So every write goes
   * through {@link write}, which re-points the selection at the column it just
   * wrote. `clear` is the one that does not, and deliberately.
   *
   * Local and unpersisted, like the tab it replaces: which bay you were last
   * inside is a fact about this sitting.
   */
  const [active, setActive] = useState(0);
  const col = columns[active] ?? null;
  const axes = col ? metricAxes(col.metric) : null;
  const full = columns.length >= MAX_LINEUP_COLUMNS;

  /** Every other bay's key, so this bay's tracks can grey what they hold. */
  const takenElsewhere = new Set(
    columns.filter((_, i) => i !== active).map(lineupColumnKey),
  );

  /**
   * Persist a selection and keep the panel on the column it just wrote.
   *
   * `normalizeLineupColumns` is the same fold the store applies, so the index
   * found here is the one the next render will number the bay by — asking the
   * store what it did rather than predicting it is what keeps the two from
   * disagreeing the day the sort changes.
   */
  const write = (next: readonly LineupColumn[], follow: LineupColumn) => {
    storeLineupColumns(next);
    const key = lineupColumnKey(follow);
    const at = normalizeLineupColumns(next).findIndex(
      (c) => lineupColumnKey(c) === key,
    );
    if (at >= 0) setActive(at);
  };

  /** Replace the active bay, keeping its pricing where the new metric has one. */
  const setColumn = (next: LineupColumn) =>
    write(
      columns.map((c, i) => (i === active ? next : c)),
      next,
    );

  /**
   * Empty the active bay, and stay on it.
   *
   * The one write that does not follow a column, because there is no longer one
   * to follow: what the reader is looking at is the socket they emptied, and
   * the panel's `Add` key is what it now offers.
   */
  const clear = () => storeLineupColumns(columns.filter((_, i) => i !== active));

  /**
   * Fill the active bay.
   *
   * `nextColumn` survives the rewrite for exactly this press, and its rule with
   * it: the first pricing the metric is not already held on, so a first press
   * always lands on `Auto · Auto`. The metric is the first one in canonical
   * order with a free pricing, which on a page with three ROS bays is the first
   * thing a reader has not already got.
   */
  const add = () => {
    if (full) return;
    for (const metric of LINEUP_METRIC_IDS) {
      const next = nextColumn(metric, columns);
      if (next) {
        write([...columns, next], next);
        return;
      }
    }
  };

  /**
   * Which cells a press on one axis could land on, in preference order.
   *
   * **A filled bay keeps the axis the reader is not pressing**, which is what
   * makes the grid's holes visible rather than silently routed around: sitting
   * on `All` and pressing `Proj` has no metric behind it, so the key greys with
   * the reason instead of quietly moving the scope to `Starters` and answering
   * a question nobody asked.
   *
   * **An empty bay has no other axis to keep**, so a press composes with
   * whichever of the free cells comes first. That is what "add and edit are one
   * thing" has to mean once the tracks are live on an empty bay: pressing
   * `Capital` fills the bay rather than doing nothing, and it lands on a column
   * no sibling already holds — `Proj` with bay 01 on `Proj · Starters` opens
   * `Proj · Bench` rather than greying.
   */
  const scopesFor = (value: ColumnValue): ColumnScope[] =>
    axes
      ? metricAt(value, axes.scope)
        ? [axes.scope]
        : []
      : COLUMN_SCOPES.filter((scope) => metricAt(value, scope));

  const valuesFor = (scope: ColumnScope): ColumnValue[] =>
    axes
      ? metricAt(axes.value, scope)
        ? [axes.value]
        : []
      : COLUMN_VALUES.filter((value) => metricAt(value, scope));

  /**
   * Whether pressing a cell would land on a column a sibling bay holds.
   *
   * The pricing carries over from the bay's current setting, so the collision
   * is checked against the column the press would actually write rather than
   * against the metric alone — otherwise two bays could never hold one metric,
   * which is the whole reason the axes moved into the column.
   */
  const cellTaken = (metric: LineupMetricId) =>
    takenElsewhere.has(
      lineupColumnKey(
        column(metric, col?.format ?? "auto", col?.lineup ?? "auto"),
      ),
    );

  /** Write the first candidate that is not already spoken for, or nothing. */
  const apply = (candidates: readonly LineupMetricId[]) => {
    const metric = candidates.find((id) => !cellTaken(id));
    if (!metric) return;
    if (col) {
      setColumn(column(metric, col.format, col.lineup));
      return;
    }
    if (full) return;
    const next = nextColumn(metric, columns);
    if (next) write([...columns, next], next);
  };

  /**
   * Why an axis key is off, or null where it can be pressed.
   *
   * Two different reasons, and a key that is off says which: the pairing has no
   * metric behind it at all (`cellGapReason` — the grid's two holes), or every
   * column it could make is already in another bay. A grey with no title is a
   * key a reader cannot find out anything about, which is the one thing this
   * panel's disable-rather-than-correct rule cannot afford.
   */
  const valueOff = (value: ColumnValue): string | null => {
    const scopes = scopesFor(value);
    if (scopes.length === 0) {
      return (
        (axes && cellGapReason(value, axes.scope)) ?? NO_COLUMN_READS_THAT
      );
    }
    const metrics = scopes.map((scope) => metricAt(value, scope)!);
    return metrics.some((id) => !cellTaken(id)) ? null : BAY_HOLDS;
  };

  const scopeOff = (scope: ColumnScope): string | null => {
    const values = valuesFor(scope);
    if (values.length === 0) {
      return (
        (axes && cellGapReason(axes.value, scope)) ?? NO_COLUMN_READS_THAT
      );
    }
    const metrics = values.map((value) => metricAt(value, scope)!);
    return metrics.some((id) => !cellTaken(id)) ? null : BAY_HOLDS;
  };

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
            saying how many of the four were in use. It stands on the page's own
            row above the grid now, and the panel it opens states the budget in
            its own heading — so a figure here would be the same news twice, and
            the legend says what the key *does*. */}
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
        // 28rem, which the four-across rack needs: a bay is 94px at that width
        // and 74px at 390, both of which hold an abbreviated unit over its
        // board pair.
        //
        // It still scrolls rather than clipping. The panel is 620px now and
        // fits the UA's `max-height` at both widths, but a `<dialog>` that
        // hides its overflow puts *Done* somewhere no scroll can reach the day
        // a reader's own type scale or a long metric name pushes it over —
        // which is the state this rewrite found it in. `overflow-y-auto` still
        // clips to the radius, which is what the hidden was doing the rest of
        // its work for.
        className="lab-scroll m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-3xl border border-foreground/12 bg-background bg-[image:var(--panel-bg)] p-0 text-foreground shadow-[var(--panel-shadow),0_24px_60px_-34px_var(--surface-shadow)] backdrop:bg-black/60"
      >
        {/* The grain wraps the content rather than the dialog's own box: on a
            scrolled panel an `inset-0` overlay would end at the fold. */}
        <div className="relative p-[1.125rem] sm:p-5">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
          />
          <div className="relative flex items-baseline justify-between gap-3">
            <h2 className="m-0 font-display text-[length:var(--fs-16)] font-semibold tracking-[-0.01em]">
              Card columns
            </h2>
            {/* The budget, in the heading's own row: a number that moves as you
                press, which is the one reading on this panel. `bays` is dropped
                below `sm`, where the word is the widest half of a figure that
                has to share a line with the title. */}
            <span
              aria-live="polite"
              className="shrink-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] tabular-nums text-foreground/72 sm:tracking-[0.16em]"
            >
              {columns.length} of {MAX_LINEUP_COLUMNS}
              <span className="hidden sm:inline"> bays</span>
            </span>
          </div>
          <p className="relative m-0 mt-1.5 font-mono text-[length:var(--fs-11)] leading-normal text-foreground/62">
            Pick a bay to set what it reads.
            <span className="hidden sm:inline"> The card updates as you press.</span>
          </p>

          {/* The rack. Always four, because the budget is the shape rather than
              a rule stated under it — an empty bay is what says a column is
              free to take, and a full rack is what says none is.

              **Four across at both widths**, where it used to be two by two: a
              row of four is the tile strip it configures, and it is what makes
              the selected bay read as one-of-four rather than one-of-a-grid. */}
          <ul
            className={`${CONSOLE_WELL} relative m-0 mt-3 grid list-none grid-cols-4 gap-[0.3125rem] p-[0.3125rem] sm:mt-3.5 sm:gap-1.5 sm:p-1.5`}
          >
            {Array.from({ length: MAX_LINEUP_COLUMNS }, (_, i) => (
              <li key={i} className="min-w-0">
                <BayKey
                  index={i}
                  column={columns[i] ?? null}
                  active={i === active}
                  onSelect={() => setActive(i)}
                />
              </li>
            ))}
          </ul>

          {/* The active bay's own options, and only those. A KTC bay carries
              four tracks and everything else carries two — which is what
              "only the active column's options" buys: nothing is greyed here
              for being inapplicable to a column the reader is not editing. */}
          <div className="relative mt-3 flex flex-col gap-2 rounded-[0.875rem] border border-active/28 bg-[image:var(--key-bg)] p-3 shadow-[var(--well-shadow),0_0_24px_-14px_var(--accent-glow)]">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-active/40 bg-[image:var(--readout-bg)] px-2.5 py-1 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-readout [text-shadow:var(--readout-text-glow)] sm:text-[length:var(--fs-10-5)] sm:tracking-[0.14em]">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
                />
                Bay {bayNumber(active)}
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-13)] font-semibold tracking-[-0.01em] text-foreground/92 sm:text-[length:var(--fs-15)]">
                {col ? LINEUP_METRIC_LABELS[col.metric].column : "Composing"}
              </span>
              {/* `Clear` on a filled bay, `Add` on an empty one — the same key,
                  because the bay has one thing to do to it either way. The
                  last bay standing cannot be cleared and the fifth cannot be
                  added: disabled, which is how every bound in this panel is
                  enforced. */}
              <button
                type="button"
                onClick={col ? clear : add}
                disabled={col ? columns.length === 1 : full}
                className={`${CONSOLE_KEY_BLOCK} shrink-0 border-foreground/14 bg-[image:var(--key-bg)] px-2.5 text-[length:var(--fs-9)] tracking-[0.12em] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 sm:text-[length:var(--fs-10)] sm:tracking-[0.14em]`}
              >
                {col ? "Clear" : "Add"}
              </button>
            </div>

            <span
              aria-hidden
              className="h-px bg-[image:var(--groove)] shadow-[0_1px_0_rgba(255,255,255,0.05)]"
            />

            <SwitchTrack
              label="Value"
              legend
              options={COLUMN_VALUES}
              value={axes?.value ?? null}
              onChange={(value) =>
                apply(scopesFor(value).map((scope) => metricAt(value, scope)!))
              }
              labels={COLUMN_VALUE_LABELS}
              className=""
              size="row"
              unavailable={valueOff}
            />
            <SwitchTrack
              label="Scope"
              legend
              options={COLUMN_SCOPES}
              value={axes?.scope ?? null}
              onChange={(scope) =>
                apply(valuesFor(scope).map((value) => metricAt(value, scope)!))
              }
              labels={COLUMN_SCOPE_LABELS}
              className=""
              size="row"
              unavailable={scopeOff}
            />

            {col && isKtcMetric(col.metric) && (
              <>
                <KtcBoardKeys
                  board={col.format}
                  onChange={(format) => setColumn({ ...col, format })}
                  size="row"
                  legend
                  className=""
                  taken={(format) =>
                    takenElsewhere.has(lineupColumnKey({ ...col, format }))
                  }
                />
                <KtcLineupKeys
                  lineup={col.lineup}
                  onChange={(lineup) => setColumn({ ...col, lineup })}
                  size="row"
                  legend
                  className=""
                  taken={(lineup) =>
                    takenElsewhere.has(lineupColumnKey({ ...col, lineup }))
                  }
                />
              </>
            )}

            {/* **What the bay reads, in words**, composed on every press from
                the metric's own sentence and the board clause. It is the one
                thing the rack cannot say: a bay is four characters of unit over
                a board pair, and `KTC · Dyn · SF` does not tell a reader that
                the number includes the picks. */}
            <div
              className={`${CONSOLE_WINDOW} mt-0.5 flex flex-col gap-1 rounded-[0.625rem] px-3 py-2.5 sm:flex-row sm:items-start sm:gap-2.5`}
            >
              <Scanlines />
              <span
                aria-hidden
                className="relative font-mono text-[length:var(--fs-9)] uppercase leading-[1.45] tracking-[0.16em] text-readout-label sm:w-[4.375rem] sm:shrink-0"
              >
                Reads
              </span>
              <p className="relative m-0 min-w-0 flex-1 font-mono text-[length:var(--fs-10-5)] leading-[1.45] text-readout-line text-pretty">
                {col ? reads(col) : "Nothing yet. Press a value to fill this bay."}
              </p>
            </div>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
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
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={`${CONSOLE_KEY_BLOCK} ml-auto border-active/50 bg-[image:var(--key-bg)] px-5 text-[length:var(--fs-10)] text-readout shadow-[var(--key-shadow),0_0_22px_-8px_var(--accent-glow)] [text-shadow:var(--readout-text-glow)]`}
            >
              Done
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Why a cell key is off: a sibling bay already holds the column it would make. */
const BAY_HOLDS = "Another bay is on this column";

/** The last resort, where a pairing has no metric and no reason names it. */
const NO_COLUMN_READS_THAT = "No column reads that";

/**
 * One socket on the rack: what the bay reads, and whether it is the one being
 * edited.
 *
 * **The active bay is the only one raised out of the tray.** A filled bay that
 * is not active keeps `--window-shadow` and stays set into the well; the active
 * one takes an accent border, a riser and a lamp in its corner. That difference
 * is what makes the rack read as one-of-four rather than as a grid of four
 * equals — and it is why the detail panel below needs no heading saying which
 * bay it is editing beyond its own lamp chip.
 *
 * An empty bay is a dashed recess rather than an unlit window, because an unlit
 * window reads as an instrument that has failed where an open socket reads as
 * one waiting. It is selectable: selecting it is how a column is added.
 *
 * The second line is the *setting* (`Auto · Auto`) on a KTC bay and the scope
 * elsewhere, which is the same pair the card's tile prints — except that the
 * tile prints what the setting *resolved to* for its own league (`Dyn·SF`). A
 * panel that has never seen a league cannot name a market for one, and `Auto`
 * is the honest word for a rule.
 */
function BayKey({
  index,
  column: col,
  active,
  onSelect,
}: {
  index: number;
  column: LineupColumn | null;
  active: boolean;
  onSelect: () => void;
}) {
  const words = col ? LINEUP_METRIC_LABELS[col.metric] : null;
  // **Two units, switched by the cascade rather than by state.** A bay is 94px
  // at the dialog's desktop width and 72px at 390, and inside the second one
  // there are ~58px for this line — where `Draft cap`, `KTC start` and `KTC
  // picks` all measure 61.5px at `--fs-10`. The long form is the card tile's
  // own `unit`, which is what makes the bay read as the tile it configures; the
  // short form is the *value* axis the track below sets, which is the same word
  // one grain coarser and cannot clip. The metric's full name is on the detail
  // panel either way, and in this key's accessible name.
  const short = col ? COLUMN_VALUE_LABELS[metricAxes(col.metric).value] : null;
  const second = !col
    ? ""
    : isKtcMetric(col.metric)
      ? ktcChoiceLabel(col)
      : LINEUP_METRIC_LABELS[col.metric].scope;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      // The name is the whole bay, spoken: a button reading "KTC" in a row of
      // four numbered sockets says nothing about which socket it is.
      aria-label={
        col
          ? `Bay ${bayNumber(index)}, ${words!.column}${second ? `, ${second}` : ""}`
          : `Bay ${bayNumber(index)}, empty`
      }
      className={
        "relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-[0.5625rem] border px-1.5 py-[0.4375rem] text-left " +
        "transition-[color,box-shadow,border-color] duration-150 " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:gap-[0.3125rem] sm:rounded-[0.625rem] sm:px-2 sm:py-[0.5625rem] " +
        (col
          ? active
            ? "border-active/55 bg-[image:var(--readout-bg)] shadow-[inset_0_0_20px_rgba(0,255,229,0.18),0_3px_0_rgba(0,0,0,0.7),0_8px_16px_-8px_#000,0_0_22px_-8px_var(--accent-glow)]"
            : "border-black/85 bg-[image:var(--readout-bg)] shadow-[var(--window-shadow)]"
          : active
            ? "border-dashed border-active/40 bg-[image:var(--key-bg)] shadow-[var(--track-shadow)]"
            : "border-dashed border-foreground/22 bg-[image:var(--key-bg)] shadow-[var(--track-shadow)]")
      }
    >
      {col && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
        />
      )}
      <span aria-hidden className="relative flex items-center justify-between gap-1">
        <span
          className={`font-mono text-[length:var(--fs-8-5)] tracking-[0.12em] sm:text-[length:var(--fs-9)] sm:tracking-[0.16em] ${
            col
              ? active
                ? "text-readout-line"
                : "text-readout-label"
              : "text-foreground/42"
          }`}
        >
          {bayNumber(index)}
        </span>
        {active && (
          <span className="size-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)] sm:size-1.5" />
        )}
      </span>
      <span
        aria-hidden
        className={`relative truncate font-mono text-[length:var(--fs-10)] uppercase leading-[1.15] sm:text-[length:var(--fs-11)] sm:tracking-[0.02em] ${
          col
            ? active
              ? "text-readout-line"
              : "text-readout-label"
            : "text-foreground/55"
        }`}
      >
        {words ? (
          <>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{words.unit}</span>
          </>
        ) : (
          "Open"
        )}
      </span>
      <span
        aria-hidden
        className={`relative min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-8-5)] uppercase leading-[1.15] sm:text-[length:var(--fs-9)] sm:tracking-[0.04em] ${
          col
            ? active
              ? "text-readout [text-shadow:var(--readout-text-glow)]"
              : "text-readout-label"
            : "text-foreground/40"
        }`}
      >
        {second}
      </span>
    </button>
  );
}

/**
 * The pricing a press should open this metric on: the first one it is not
 * already held on, scanning both axes in control order, or null where every
 * pricing is taken.
 *
 * `auto` on both axes comes first, which is what makes an added bay's first
 * state `Auto · Auto` — the only presses that land elsewhere are on a metric
 * already in a bay, and those show the pair they opened on immediately.
 *
 * The five metrics with no market have exactly one pricing by construction
 * (`column` forces both axes to `auto` on them), so this answers null for a
 * chosen one and the caller moves on to the next metric.
 */
function nextColumn(
  metric: LineupMetricId,
  columns: readonly LineupColumn[],
): LineupColumn | null {
  const taken = new Set(columns.map(lineupColumnKey));
  for (const format of KTC_BOARD_CHOICES) {
    for (const lineup of KTC_LINEUP_CHOICES) {
      const candidate = column(metric, format, lineup);
      if (!taken.has(lineupColumnKey(candidate))) return candidate;
    }
  }
  return null;
}

/** `01`–`04`. Two digits because a bay is a socket on a rack, not a list item. */
function bayNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** The bay's whole reading: the metric's own sentence, then its board clause. */
function reads(col: LineupColumn): string {
  const words = LINEUP_METRIC_LABELS[col.metric];
  return isKtcMetric(col.metric)
    ? `${words.option} ${boardClause(col)}`
    : words.option;
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
