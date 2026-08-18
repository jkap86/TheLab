"use client";

// The columns' width, inset and row box. They moved to `features/shared` once the
// lineup checker's rows wore the same four columns — the geometry has to line up
// to the pixel between a card and the rail that heads it, so it is one
// definition; this feature reads it from where its own consumers already do.
// Relative rather than aliased, the rule every runtime import that may end up
// under the test runner keeps: `tsx --test` resolves a relative path and not
// `@/`.
import type { Metric, MetricCell } from "../metric-cell.ts";

import { COLUMN_BOX, COLUMN_ROW, COLUMN_WIDTH } from "./stat-columns";

/**
 * The cluster of stat columns across a card — the league cards' four rankings,
 * the share cards' four counts.
 *
 * Which metric each slot shows is held in the list, so every card shows the same
 * columns and they line up down the page; this renders them and owns nothing but
 * which picker is open.
 *
 * **A card never names its columns — the heading rail does, at every width.** The
 * label used to come back below `sm`, where the rail was dropped, which made the
 * list read as two different products either side of that breakpoint: a heading
 * row on a laptop, four per-card labels on a phone, saying the selection was a
 * fact about *this* card. The rail is drawn at both widths now (it moves onto a
 * line of its own down there, exactly as the card's columns do), so the labels
 * come off here for good and the cards keep the numbers alone.
 */
export function MetricColumns<C>({
  metrics,
  ctx,
  columns,
}: {
  metrics: Metric<C>[];
  ctx: C;
  /** The metric key each column shows, shared by every card in the list. */
  columns: string[];
}) {
  return (
    <div className={`${COLUMN_ROW} divide-x divide-foreground/10`}>
      {columns.map((key, slot) => (
        <MetricColumn key={slot} metrics={metrics} metricKey={key} ctx={ctx} />
      ))}
    </div>
  );
}

/**
 * One stat column on a card: the chosen metric, read off this card's subject and
 * rendered, under the heading rail that names it.
 *
 * Generic in what the metrics read from, because two grains now wear these
 * columns — a league card reads a league's ranks and values, a share card reads
 * the leagues behind one player or leaguemate. The catalogue is passed in rather
 * than imported here, which is what keeps the column ignorant of both.
 *
 * It is a cell and nothing more: the selection is list-wide, so the control that
 * moves it is the heading rail above the list and never a card, which is what
 * frees a row of a hundred to be four numbers.
 */
export function MetricColumn<C>({
  metrics,
  metricKey,
  ctx,
}: {
  /** The catalogue this column picks from — the card's grain decides which. */
  metrics: Metric<C>[];
  /** The selected metric's key; falls back to the first metric if unknown. */
  metricKey: string;
  ctx: C;
}) {
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const cell = metric.cell(ctx);

  return (
    <div className={`relative flex flex-col gap-1 ${COLUMN_BOX}`}>
      {/*
        The name, for a reader who can't see the heading rail lining up with this
        column. Nothing on the card says what the number is, so without this a
        screen reader announces "#3 of 12" with no word for what it ranks.
      */}
      <span className="sr-only">{metric.label}</span>

      <StatBody cell={cell} title={cell.title} />
    </div>
  );
}

/**
 * The stat columns' labels, stated once above the list rather than on every row.
 *
 * The selection is list-wide — moving a column moves it on all hundred-odd cards
 * — but drawn per card it read as a per-card control, which is the whole reason
 * changing four columns felt like four unrelated errands. The headings are the
 * same pickers in one place, laid on the cards' own geometry so each sits over
 * the numbers it names — at *every* width, which is what makes it the only
 * picker there is: the cards used to grow their own labels and menus back below
 * `sm`, so the same list was a table with a heading rail on a laptop and four
 * per-card controls on a phone.
 *
 * It takes no context and shows no preview values: a heading belongs to the
 * whole list, and a preview here would be one arbitrary row's numbers offered as
 * if they described the column. The editor is where previews belong, because it
 * says out loud which subject it is previewing against.
 *
 * **A heading opens the editor at its own slot; it carries no menu of its own.**
 * The rail used to hang a flat list of the whole catalogue under whichever label
 * was pressed, which is the four-menus-four-passes shape the editor was built to
 * replace — and having both left the board editable two ways, one of which
 * couldn't show a preview, name a preset or say which other slot already held the
 * metric being picked. So the label *is* the trigger, and the slot it names is
 * the slot the dialog opens armed on: pressing "Proj bench" is a press on the
 * column you meant, not a press on a dialog you then have to aim.
 *
 * **The rail is a raised billet, and that is the material saying what it is.**
 * Four flat labels over a list read as a caption on the page; these are triggers,
 * and a part you press is raised everywhere else in this app. It is `.lab-key`'s
 * construction — wall, lit face, the app bar's notch — held to the columns' own
 * geometry, so the list visibly scrolls *under* the thing naming its columns
 * rather than past a line of text. The shading is all in `.lab-ledge` in
 * `globals.css`; what stays here is the layout, per the rule those classes hold
 * to.
 *
 * **This renders the face's *contents* and not the billet, which is the one
 * thing to know before editing it.** The wall, the notch and the face belong to
 * {@link ListLedge} now, because the billet grew a second storey: the subject
 * filter — which of these leagues hold a given player, or are shared with a
 * given leaguemate — sits above the headings, and drawn as a part of its own it
 * would have paid for a second wall, a second cast shadow and the clearance
 * holding two lit faces apart. Everything below still describes the rail; what
 * moved is where the three material classes are applied.
 *
 * **Each heading is cut into that face rather than painted on it, and it carries
 * no caret.** The rail read as a grey band between the filter dock and the first
 * card, and the cause was material before it was typographic: the face ended
 * *darker* than the cards it heads, and four 10px labels lying flat on it are
 * text whatever weight they are set in. The face is lighter than the rows now
 * (`.lab-ledge-face`), and the label sits in a `.lab-ledge-slot` — the app bar's
 * milled channel at heading scale, which is this app's existing answer to making
 * a small label read as a part. The slot does the caret's job better than the
 * caret did: a channel says "this is a control" without spending two characters
 * of a label that has to fit in 76px, and it marks where the four columns are
 * before the words are read at all.
 *
 * **The billet spans the row, and its first cell names the row's subject.** It
 * used to shrink-wrap the four columns, which put a raised island over the right
 * two-fifths of the list with a hundred card-widths of nothing to its left — at
 * that size it reads as a toolbar that happens to sit above a list rather than as
 * the list's own header, and the alignment that ties it to the numbers is a
 * pixel-level fact a reader has to go looking for. Run to the cards' full width
 * with `League` / `Player` / `Leaguemate` over the name column, it is the shape
 * every table header has: the labelled band covers the rows it labels, and the
 * four stat headings are cells in it rather than a floating cluster. Only the
 * subject cell is new geometry — the stat columns keep {@link COLUMN_BOX} to the
 * pixel, so what lines them up with the numbers is unchanged.
 *
 * The subject cell is not a trigger and takes no lit hover: there is no column
 * behind it to aim, and a heading that lights under the cursor and then does
 * nothing is the promise this app's raised/recessed grammar exists to keep. It is
 * drawn from `sm` up only, where the card's name and its columns share a line;
 * below that the card stacks and the rail stacks with it, so the columns take the
 * whole width and a subject label would be naming a line that isn't there.
 */
export function MetricHeadings({
  metrics,
  columns,
  subject,
  onOpen,
}: {
  /** The catalogue — only the label of each column's own metric is read. */
  metrics: readonly { key: string; label: string }[];
  columns: string[];
  /** What one row of this list *is* — the heading over the name column. */
  subject: string;
  /** Open the editor armed on this slot. */
  onOpen: (slot: number) => void;
}) {
  return (
    <>
      {/*
        The name column's own heading, and the half of this rail that makes it
        read as one. It takes the space the four cells don't (`flex-1`), which
        is exactly the space a card's name half takes, and it is inert — no
        `.lab-ledge-col`, so it neither lights under the cursor nor cuts a
        groove of its own against the first stat heading (the face's `divide-x`
        draws that one, which is the line between what a row *is* and what is
        measured about it).
      */}
      <span className="hidden min-w-0 flex-1 items-center truncate py-[0.5625rem] pl-1 pr-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-foreground/75 sm:flex">
        {subject}
      </span>

      {columns.map((key, slot) => {
        const metric = metrics.find((m) => m.key === key) ?? metrics[0];
        return (
          <div
            key={slot}
            // The cell's own inset less the slot's own 4px, so the label
            // starts at the same x as the number under it: nothing below `sm`,
            // where {@link COLUMN_BOX} spends 4px and the slot is all of it,
            // and 6px from `sm`, where it spends 10. The vertical padding is
            // the same trade, so the rail is exactly as tall as it was — a
            // heading that grows takes its height out of the list behind it.
            className={`lab-ledge-col group/col relative px-0 py-1.5 sm:px-1.5 ${COLUMN_WIDTH}`}
          >
            <button
              type="button"
              onClick={() => onOpen(slot)}
              aria-haspopup="dialog"
              // The full label, in case a catalogue ever grows one past the
              // column's width — a truncated heading is the only name its
              // column has.
              title={metric?.label}
              className="block w-full text-left"
            >
              <span className="lab-ledge-slot block truncate rounded-[3px] px-1 py-[3px] text-[0.625rem] font-semibold uppercase tracking-wider text-foreground/90 transition-colors group-hover/col:text-active">
                {metric?.label}
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}

const TIER_TEXT: Record<Tier, string> = {
  hi: "text-active",
  mid: "text-foreground/85",
  lo: "text-rose-300",
};
const TIER_FILL: Record<Tier, string> = {
  hi: "bg-active",
  mid: "bg-foreground/40",
  lo: "bg-rose-400/80",
};

type Tier = "hi" | "mid" | "lo";

/**
 * Where a rank falls in its league as a fraction (1 for first, 0 for last), and
 * the tier that fraction lands in. The tiers are wide bands, not thirds, so the
 * accent is reserved for genuinely near the top and rose for genuinely near the
 * bottom — most rows read as the neutral middle, which is what keeps a card of
 * four colours from looking like an alarm.
 */
function rankTier(rank: { rank: number; of: number }): { p: number; tier: Tier } {
  const p = rank.of <= 1 ? 1 : (rank.of - rank.rank) / (rank.of - 1);
  const tier: Tier = p >= 0.62 ? "hi" : p <= 0.3 ? "lo" : "mid";
  return { p, tier };
}

/**
 * The number and meter under a column's label. A rank is placed and metered by
 * where in its league it sits; a share is metered by its plain fraction, more
 * being more; a value is printed plain, since there is nothing to place it
 * against. All three keep the same three-row height — label, number, a track
 * strip — so mixing them in one row leaves the numbers on a shared baseline.
 *
 * **Every number here steps down one size below `sm`, and that is the phone
 * paying for `--app-font-scale` in the one place with nothing to pay it with.**
 * From `sm` the column is a fixed 96px and scales with everything else; below it
 * the four columns divide *the phone's own line*, which is the single length in
 * the app that cannot scale — so raising the type squeezes them from both ends,
 * the card's insets growing while the ink does. Measured in Chromium against the
 * compiled stylesheet and the real `woff2` files, at a scale of 1 a 360px
 * viewport had **no slack at all**: `3,249.98` (what `formatPoints` gives three
 * of the league catalogue's metrics) and `121/121` (a share on a hundred-league
 * account) each measured their column to the pixel. Held at their old sizes they
 * overflow at 360, 375 and 390 alike.
 *
 * So below `sm` the value arm is `text-xs`, the rank and share numbers are
 * `text-sm`, their denominators `0.625rem`, and {@link COLUMN_BOX} gives 6px of
 * inset back. At 360 that is 57.9px of ink in 61 for the widest value and 58 in
 * 61 for the widest share — the first spelling with slack rather than merely the
 * first that fits. What it costs is that a phone's numbers stay roughly the size
 * they are today (13.5px against 14) while every other thing on the page grows,
 * which is the honest trade for a column that was already full.
 */
function StatBody({ cell, title }: { cell: MetricCell; title: string }) {
  if (cell.kind === "share") {
    // Metered but never tiered: a player in 8 of 121 leagues is a small share,
    // not a bad one, so borrowing a rank's colours would read as an alarm on
    // nearly every row. The accent marks the fill and the number stays neutral.
    const p = cell.of > 0 ? cell.held / cell.of : 0;
    return (
      <>
        <span title={title} className="flex items-baseline gap-0.5 leading-none">
          <span className="text-sm font-bold tabular-nums text-foreground/85 sm:text-base">
            {cell.held}
          </span>
          <span className="text-[0.625rem] tabular-nums text-foreground/40 sm:text-[0.6875rem]">
            /{cell.of}
          </span>
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          {cell.held > 0 && (
            <span
              className="block h-full rounded-full bg-active/70"
              style={{ width: `${Math.max(6, p * 100)}%` }}
            />
          )}
        </span>
      </>
    );
  }

  if (cell.kind === "value") {
    return (
      <>
        {cell.text ? (
          <span
            title={title}
            // Amber only where the catalogue asked for it — see
            // {@link MetricTone}. A tinted number is a verdict, and four of them
            // on a card would be four alarms.
            //
            // The step down below `sm` is {@link StatBody}'s own rule, not this
            // arm's — see the note there.
            className={`text-xs font-bold leading-none tabular-nums sm:text-sm ${
              cell.tone === "alert" ? "text-amber-300" : "text-foreground/85"
            }`}
          >
            {cell.text}
          </span>
        ) : (
          <span className="text-sm font-bold leading-none text-foreground/25 sm:text-base">
            —
          </span>
        )}
        {/* No meter — a value has no denominator to place it in — but the strip's
            height is held so value and rank columns share a baseline. */}
        <span className="h-1 w-full" />
      </>
    );
  }

  const t = cell.rank ? rankTier(cell.rank) : null;
  return (
    <>
      {cell.rank && t ? (
        <span title={title} className="flex items-baseline gap-0.5 leading-none">
          <span
            className={`text-sm font-bold tabular-nums sm:text-base ${TIER_TEXT[t.tier]}`}
          >
            #{cell.rank.rank}
          </span>
          <span className="text-[0.625rem] tabular-nums text-foreground/40 sm:text-[0.6875rem]">
            /{cell.rank.of}
          </span>
        </span>
      ) : (
        <span className="text-sm font-bold leading-none text-foreground/25 sm:text-base">
          —
        </span>
      )}
      <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        {cell.rank && t && (
          <span
            className={`block h-full rounded-full ${TIER_FILL[t.tier]}`}
            style={{ width: `${Math.max(6, t.p * 100)}%` }}
          />
        )}
      </span>
    </>
  );
}
