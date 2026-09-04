"use client";

import { useRef, useState } from "react";

import type {
  KtcBoardChoice,
  KtcLineupChoice,
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
  CONSOLE_READOUT,
  CONSOLE_TRACK,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
} from "../console-chrome";
import {
  column,
  ktcChoiceLabel,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  MAX_LINEUP_COLUMNS,
  storeLineupColumns,
} from "../lineup-columns";
import { KtcBoardKeys, KtcLineupKeys } from "./ktc-board-keys";
import { Scanlines } from "./card-plate";

/**
 * The column picker: a trigger key and a native `<dialog>`, which is the whole
 * reason there is no dependency here — `showModal()` brings the focus trap,
 * the Esc-to-close and the `::backdrop` with it.
 *
 * **The budget is the UI.** Nine checkbox rows became four numbered bays,
 * because four is what the card's tile row holds and a panel shaped like the
 * thing it configures does not have to state its own rule: a reader can see
 * there is one bay free, and the rack is full when nothing is dashed. The
 * checkbox-and-lamp markup is gone entirely — every control in here is a
 * `<button>`, which is what the two-axis bays need anyway.
 *
 * A press writes immediately rather than staging an "apply": the cards update
 * live behind the dialog, which *is* the preview, and there is no draft state
 * to reconcile with a change from another tab. The bounds are still enforced by
 * disabling rather than refusing — at {@link MAX_LINEUP_COLUMNS} the keys that
 * would open a fifth bay grey out, and the last bay's clear key does too, so
 * the selection can never be invalid in the first place.
 *
 * **The KeepTradeCut board moved out of this panel's foot and into the bays**,
 * which is the change the rest follows from. A global board key is contradicted
 * by a column that names its own: the market is not a property of the page, it
 * is what one of these four columns *means*, and putting it in the bay is what
 * lets two bays hold one metric on two boards — which is the comparison a
 * dynasty reader opens this panel to make. The second axis, 1QB against
 * superflex, arrives with it for the same reason. What survives of the old foot
 * is the scrape line: these are someone else's numbers on a fifteen-minute
 * cache, and anything showing them should be able to say how old they are.
 *
 * `storeKtcBoard` / `useKtcBoard` stay where they are — the trades board is a
 * different call site with a different argument (see that route on why one page
 * sends the choice and the other does not), and only the manager page's columns
 * stop reading a page-wide board.
 *
 * **It moved here from `features/manager/components` when the app rack became a
 * second reader** — the line `CONSOLE_KEY`, `ManagerPlate`, `LeagueFiltersDialog`
 * and `LeagueConfigWindow` all moved on. It came back down onto the page since,
 * and `ColumnsStrip` is its one call site, which is what the trigger's legend
 * below is written for.
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
  // Local, and deliberately unpersisted: a tab is a way of reading the key list
  // in this sitting, not a device preference — the same call `LeagueTeams`
  // makes about its own metric select.
  const [tab, setTab] = useState<Family | "all">("all");
  const full = columns.length >= MAX_LINEUP_COLUMNS;

  const clear = (index: number) =>
    storeLineupColumns(columns.filter((_, i) => i !== index));

  /**
   * Move one bay onto a pricing.
   *
   * A plain write, because the pricings the *other* bays hold are greyed out on
   * these two switches (see `SwitchTrack`'s `taken`) — so a press that would
   * duplicate a column cannot be made rather than being repaired after, which
   * is the rule the budget above is already enforced by. `normalize`'s dedupe
   * stays the backstop for a stored value nothing in here wrote.
   */
  const setPricing = (index: number, next: LineupColumn) =>
    storeLineupColumns(columns.map((c, i) => (i === index ? next : c)));

  const add = (metric: LineupMetricId) => {
    const next = nextColumn(metric, columns);
    if (!next || full) return;
    storeLineupColumns([...columns, next]);
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
            saying how many of the four were in use. It stands in the page's own
            columns tray now, beside a lit chip per chosen column: the count is
            there already and by name, so repeating it as a figure is the same
            news twice, and the legend says what the key *does* rather than
            re-labelling the tray it is mounted in. */}
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
        // 28rem rather than the 24 it was: two bays across is what the rack
        // needs, and a bay narrower than ~200px is where "1QB" stops being a
        // word on its own switch.
        //
        // **And it scrolls, where it used to clip.** A rack of four bays over a
        // nine-key list is 862px at 390 — taller than a phone — and `<dialog>`
        // takes a UA `max-height` of the viewport less a little, so `overflow:
        // hidden` here would put the Done key somewhere no scroll could reach.
        // `overflow-y-auto` still clips to the radius, which is what the hidden
        // was doing the rest of its work for.
        className="lab-scroll m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-3xl border border-foreground/12 bg-background bg-[image:var(--panel-bg)] p-0 text-foreground shadow-[var(--panel-shadow),0_24px_60px_-34px_var(--surface-shadow)] backdrop:bg-black/60"
      >
        {/* The grain wraps the content rather than the dialog's own box: on a
            scrolled panel an `inset-0` overlay would end at the fold. */}
        <div className="relative p-[1.125rem] sm:p-5">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
          />
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 font-display text-base font-semibold tracking-[-0.01em]">
              Card columns
            </h2>
            {/* The budget, on glass: it is a number that moves as you press,
                which is the one thing on this panel that is a readout. */}
            <span
              className={`${CONSOLE_READOUT} inline-flex shrink-0 items-center rounded-full px-2.5 py-1`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
              />
              <span
                aria-live="polite"
                className="relative font-mono text-[0.6875rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]"
              >
                {columns.length} / {MAX_LINEUP_COLUMNS}
              </span>
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[0.6875rem] leading-normal text-foreground/58">
            Four bays, ranked against the rest of each league. A KTC bay sets its
            own market and lineup; Auto follows the league.
          </p>

          {/* The rack. Always four, because the budget is the shape rather than
              a rule stated under it — an empty bay is what says a column is
              free to take, and a full rack is what says none is. */}
          <ul
            className={`${CONSOLE_WELL} m-0 mt-3.5 grid list-none grid-cols-2 gap-2 p-2`}
          >
            {Array.from({ length: MAX_LINEUP_COLUMNS }, (_, i) => (
              <li key={i} className="min-w-0">
                {columns[i] ? (
                  <Bay
                    index={i}
                    column={columns[i]}
                    onClear={columns.length === 1 ? null : () => clear(i)}
                    onFormat={(format) => setPricing(i, { ...columns[i], format })}
                    onLineup={(lineup) => setPricing(i, { ...columns[i], lineup })}
                    taken={
                      new Set(
                        columns
                          .filter((_, j) => j !== i)
                          .map(lineupColumnKey),
                      )
                    }
                  />
                ) : (
                  <EmptyBay index={i} />
                )}
              </li>
            ))}
          </ul>

          <div className={`${CONSOLE_TRACK} mt-3.5 flex gap-1 p-1`}>
            {TABS.map(({ id, label, short }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`flex-1 rounded-full border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:flex-none ${
                  tab === id
                    ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
                    : "border-transparent text-foreground/58 hover:text-readout"
                }`}
              >
                {/* Two spans switched by the cascade rather than by state: a
                    client component must not have to hydrate to learn a
                    breakpoint. */}
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>{" "}
                <span className="tabular-nums">{countOf(id)}</span>
              </button>
            ))}
          </div>

          <ul
            className={`${CONSOLE_WELL} m-0 mt-2 flex list-none flex-col gap-1 p-1.5`}
          >
            {LINEUP_METRIC_IDS.filter(
              (id) => tab === "all" || FAMILY[id] === tab,
            ).map((id) => (
              <li key={id}>
                <MetricKey
                  metric={id}
                  columns={columns}
                  full={full}
                  onAdd={() => add(id)}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
            {/* What was read and when — silent where nothing could be, since
                the KTC columns already say so with their em dashes. */}
            {ktc.length > 0 && (
              <p className="m-0 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
                KTC scraped
                {ktc.map((board) => (
                  <span key={board.format}>
                    {" · "}
                    {board.format}{" "}
                    {board.updated_at ? scrapedAt(board.updated_at) : "—"}
                  </span>
                ))}
              </p>
            )}
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={`${CONSOLE_KEY_BLOCK} ml-auto border-active/50 bg-[image:var(--key-bg)] px-5 text-[0.625rem] text-readout shadow-[var(--key-shadow),0_0_22px_-8px_var(--accent-glow)] [text-shadow:var(--readout-text-glow)]`}
            >
              Done
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * One filled bay: the label the card will print, what it means, and — on a
 * KeepTradeCut column — the two switches that decide which board it reads.
 *
 * **The label is quoted, not headed**, which the accent rule beside it is what
 * says: these two lines are the tile's own, so a reader setting a column can
 * see what it will look like on a hundred cards. The pair it quotes is the
 * *setting* (`Auto · Auto`), where the tile prints what the setting resolved to
 * for its own league (`Dyn·SF`) — a panel that has never seen a league cannot
 * name a market for one, and `Auto` is the honest word for a rule.
 */
function Bay({
  index,
  column: col,
  onClear,
  onFormat,
  onLineup,
  taken,
}: {
  index: number;
  column: LineupColumn;
  /** Null on the last bay standing — see `ColumnsStrip.remove` for the rule. */
  onClear: (() => void) | null;
  onFormat: (format: KtcBoardChoice) => void;
  onLineup: (lineup: KtcLineupChoice) => void;
  /** The column keys the *other* bays hold, so this one's switches grey them. */
  taken: ReadonlySet<string>;
}) {
  const words = LINEUP_METRIC_LABELS[col.metric];
  const ktc = isKtcMetric(col.metric);
  return (
    <div className={`${CONSOLE_WINDOW} h-full rounded-[0.625rem] px-2.5 py-2`}>
      <Scanlines />
      <div className="relative flex items-center justify-between gap-2">
        <span className="font-mono text-[0.5625rem] tracking-[0.18em] text-readout-label">
          {bayNumber(index)}
        </span>
        <button
          type="button"
          onClick={onClear ?? undefined}
          disabled={!onClear}
          className="font-mono text-[0.8125rem] leading-none text-readout-muted transition-colors hover:text-readout disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        >
          <span className="sr-only">Clear bay {bayNumber(index)}</span>
          <span aria-hidden>×</span>
        </button>
      </div>

      <div className="relative mt-[0.4375rem] border-l border-active/35 pl-2">
        <p className="m-0 font-mono text-[0.5625rem] uppercase leading-[1.2] tracking-[0.1em] text-readout-label">
          {words.unit}
        </p>
        <p className="m-0 mt-px min-h-[0.6875rem] font-mono text-[0.5625rem] uppercase leading-[1.2] tracking-[0.12em] text-readout [text-shadow:var(--readout-text-glow)]">
          {ktc ? ktcChoiceLabel(col) : words.scope}
        </p>
      </div>

      <p className="relative m-0 mt-[0.4375rem] font-mono text-[0.65625rem] leading-[1.35] text-readout-line">
        {words.option}
        {ktc && ` ${boardClause(col)}`}
      </p>

      {ktc && (
        <>
          <KtcBoardKeys
            board={col.format}
            onChange={onFormat}
            size="sm"
            className="relative mt-1.5"
            taken={(format) => taken.has(lineupColumnKey({ ...col, format }))}
          />
          <KtcLineupKeys
            lineup={col.lineup}
            onChange={onLineup}
            className="relative mt-1"
            taken={(lineup) => taken.has(lineupColumnKey({ ...col, lineup }))}
          />
        </>
      )}
    </div>
  );
}

/**
 * A bay with nothing in it: a dashed recess rather than a window, because an
 * unlit window reads as an instrument that has failed where an open socket
 * reads as one waiting.
 */
function EmptyBay({ index }: { index: number }) {
  return (
    <div className="flex h-full flex-col rounded-[0.625rem] border border-dashed border-foreground/16 bg-[image:var(--key-bg)] px-2.5 py-2 shadow-[var(--track-shadow)]">
      <span className="font-mono text-[0.5625rem] tracking-[0.18em] text-foreground/30">
        {bayNumber(index)}
      </span>
      <span className="mt-[0.4375rem] font-mono text-[0.78125rem] text-foreground/34">
        Open bay
      </span>
      <span className="mt-px font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-foreground/28">
        Opens on Auto · Auto
      </span>
    </div>
  );
}

/**
 * One metric, as a key that fills a bay.
 *
 * **A KeepTradeCut key keeps its `+` while a bay is free**, and that press is
 * the feature rather than a stray affordance: pressing `KTC total` a second
 * time opens a second bay on the same metric, which is what a reader comparing
 * two markets — or a market's two QB boards — is here to do. It cannot be a
 * no-op, so what it opens is the first pricing this metric is *not* already
 * held on (see {@link nextColumn}); the five metrics with no market have
 * exactly one pricing, so a chosen one has nothing left to open and says so by
 * being disabled.
 *
 * The accessible name is the *action* where there is one and the *state* where
 * there is not, which is the same rule the columns tray's chips are named by.
 */
function MetricKey({
  metric,
  columns,
  full,
  onAdd,
}: {
  metric: LineupMetricId;
  columns: readonly LineupColumn[];
  full: boolean;
  onAdd: () => void;
}) {
  const words = LINEUP_METRIC_LABELS[metric];
  const bays = columns
    .map((c, i) => (c.metric === metric ? bayNumber(i) : null))
    .filter((n): n is string => n !== null);
  const held = bays.length > 0;
  const canAdd = !full && nextColumn(metric, columns) !== null;

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={!canAdd}
      aria-label={
        canAdd
          ? `Add ${words.column} to a bay`
          : held
            ? `${words.column}, in ${bays.length === 1 ? "bay" : "bays"} ${bays.join(" and ")}`
            : `${words.column}, no bay free`
      }
      className={
        "flex w-full items-center gap-3 rounded-[0.625rem] border px-2.5 py-2 text-left " +
        "transition-[transform,box-shadow,color] duration-150 active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] " +
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
        (held
          ? "border-active/40 bg-[image:var(--readout-bg)] shadow-[inset_0_0_14px_rgba(0,255,229,0.12),0_1px_0_rgba(255,255,255,0.07)] "
          : "border-foreground/10 bg-[image:var(--key-bg)] shadow-[var(--key-shadow)] ") +
        (canAdd ? "" : "cursor-not-allowed " + (held ? "" : "opacity-40"))
      }
    >
      <span aria-hidden className="min-w-0 flex-1">
        <span
          className={`block font-display text-[0.8125rem] font-semibold ${
            held ? "text-readout" : "text-foreground/88"
          }`}
        >
          {words.column}
        </span>
        <span
          className={`block font-mono text-[0.65625rem] ${
            held ? "text-readout-muted" : "text-foreground/52"
          }`}
        >
          {words.option}
        </span>
      </span>
      {held && (
        <span
          aria-hidden
          className="shrink-0 font-mono text-[0.5625rem] tracking-[0.18em] text-readout-label"
        >
          {bays.join(" ")}
        </span>
      )}
      {canAdd && (
        <span
          aria-hidden
          className="shrink-0 font-mono text-[0.9375rem] leading-none text-readout-label"
        >
          +
        </span>
      )}
    </button>
  );
}

/**
 * The pricing a press should open this metric on: the first one it is not
 * already held on, scanning both axes in control order, or null where every
 * pricing is taken.
 *
 * `auto` on both axes comes first, which is what makes an empty bay's "Opens on
 * Auto · Auto" true for every first press — the only presses that land
 * elsewhere are the second and later ones on a metric already in a bay, and
 * those show the pair they opened on immediately.
 *
 * The five metrics with no market have exactly one pricing by construction
 * (`column` forces both axes to `auto` on them), so this answers null for a
 * chosen one and the key disables rather than pressing to no effect.
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

/**
 * The market clause a KTC bay's sentence ends with.
 *
 * Both axes on `auto` collapse to one short phrase rather than spelling the
 * rule twice — "on each league's own market, at each league's own prices" is
 * five lines of a 144px bay saying what "its own board" says in one.
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

/** Which group of the key list a metric belongs to. */
type Family = "ros" | "capital" | "ktc";

// The fourth exhaustive `Record<LineupMetricId, …>` — a new metric breaks this
// until somebody says which tab it belongs behind.
const FAMILY: Record<LineupMetricId, Family> = {
  ros_starters: "ros",
  ros_bench: "ros",
  capital_total: "capital",
  capital_bench: "capital",
  capital_starters: "capital",
  ktc_total: "ktc",
  ktc_starters: "ktc",
  ktc_bench: "ktc",
  ktc_picks: "ktc",
};

const TABS: readonly { id: Family | "all"; label: string; short: string }[] = [
  { id: "all", label: "All", short: "All" },
  { id: "ros", label: "Ros", short: "Ros" },
  { id: "capital", label: "Capital", short: "Cap" },
  { id: "ktc", label: "KTC", short: "KTC" },
];

/**
 * How many metrics a tab offers — the population it filters to, not how many of
 * them are chosen. The budget readout above already counts the chosen ones, and
 * two counts of two different things reading the same would be worse than
 * either.
 */
function countOf(tab: Family | "all"): number {
  return tab === "all"
    ? LINEUP_METRIC_IDS.length
    : LINEUP_METRIC_IDS.filter((id) => FAMILY[id] === tab).length;
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
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
