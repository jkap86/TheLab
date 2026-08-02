"use client";

import type { Metric, MetricCell } from "../metric-cell";

/**
 * The width and gutter one stat column takes, worn by the cells on a card and by
 * the headings above the list alike.
 *
 * They are two components and they have to line up to the pixel, so the geometry
 * is written once — a heading a hair wider than the number under it reads as a
 * misaligned table, and that is exactly the drift a retyped width produces.
 *
 * **From `sm` up the width is set by the longest label, not by the numbers.** It
 * was 80px everywhere, which fits every number these columns print and truncates
 * a third of the catalogue's labels ("Proj bench" is 69px at this size). That was
 * survivable while the label sat on every card, where a reader could read it off
 * a neighbouring row; with the labels lifted into one heading rail, a truncated
 * one is the only name that column has. 96px clears the widest of them with the
 * gutters counted, and the name beside it is the field that gives up the space —
 * it truncates to a tooltip, where a heading truncates to nothing.
 *
 * **Below `sm` the columns divide the row instead of being 96px wide.** Four of
 * them at that width plus the card's insets overflow a 390px screen, which is
 * why the card stacks down there — the name takes the first line and the columns
 * take the second, whole. So a column is an equal share of that line
 * (`flex-1 min-w-0`, no fixed width to overflow), which on a phone is ~82px:
 * wider than the 80px this used to hard-code, and, more to the point, a width
 * the heading rail can reproduce exactly. That is what keeps one geometry at
 * both breakpoints rather than two — see {@link MetricHeadings}.
 */
const COLUMN_BOX = "min-w-0 flex-1 px-2.5 sm:w-24 sm:flex-none sm:shrink-0";

/**
 * The box the four columns sit in, worn by a card's cells and by the heading rail
 * alike — full width below `sm` where they divide a line of their own, shrink-
 * wrapped from `sm` up where they ride at the end of a row.
 *
 * It is written beside {@link COLUMN_BOX} for the same reason: the rail only
 * names the numbers under it if both ends resolve to the same width at the same
 * breakpoint, and a retyped `w-full` is exactly how one end stops.
 */
const COLUMN_ROW = "flex w-full items-stretch sm:w-auto sm:shrink-0";

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
 */
export function MetricHeadings({
  metrics,
  columns,
  onOpen,
}: {
  /** The catalogue — only the label of each column's own metric is read. */
  metrics: readonly { key: string; label: string }[];
  columns: string[];
  /** Open the editor armed on this slot. */
  onOpen: (slot: number) => void;
}) {
  return (
    // The wall. `COLUMN_ROW` sizes it — full width below `sm` where the headings
    // take a line of their own, shrink-wrapped to the four columns above it.
    <div className={`lab-ledge lab-notch-lg ${COLUMN_ROW}`}>
      {/*
        The face. `relative` is what the cyan seam (`::before`) and the dimples
        hang off; the material classes deliberately carry no `position`.

        `divide-x` is the groove's dark cut, and it is spelled here rather than
        in the material class because a border changes the box: the cards' own
        columns carry the same 1px *inside* their box, so without it every
        heading after the first would sit a pixel left of the number it names —
        four pixels shared out unevenly below `sm`, where the columns divide the
        row rather than taking a fixed width. The lit far wall that turns that
        cut into machining is `.lab-ledge-col`'s inset highlight.
      */}
      <div className="lab-ledge-face lab-notch-lg relative flex w-full items-stretch divide-x divide-[rgba(0,0,0,0.5)]">
        {/* The two corners the notch leaves intact — top-right and bottom-left.
            They precede the columns, which is why `.lab-ledge-col + .lab-ledge-col`
            names the class rather than using a bare sibling selector. */}
        <span
          aria-hidden="true"
          className="lab-ledge-dimple pointer-events-none absolute bottom-1 left-1 h-1 w-1 rounded-full"
        />
        <span
          aria-hidden="true"
          className="lab-ledge-dimple pointer-events-none absolute right-1 top-1 h-1 w-1 rounded-full"
        />

        {columns.map((key, slot) => {
          const metric = metrics.find((m) => m.key === key) ?? metrics[0];
          return (
            <div
              key={slot}
              className={`lab-ledge-col group/col relative py-[9px] ${COLUMN_BOX}`}
            >
              <button
                type="button"
                onClick={() => onOpen(slot)}
                aria-haspopup="dialog"
                // The full label, in case a catalogue ever grows one past the
                // column's width — a truncated heading is the only name its
                // column has.
                title={metric?.label}
                className="flex w-full items-center text-left"
              >
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-foreground/70 transition-[color,text-shadow] group-hover/col:text-active group-hover/col:[text-shadow:0_0_12px_rgba(0,255,229,0.55)]">
                  {metric?.label}
                </span>
              </button>
              <Caret />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The heading's disclosure mark: dim at rest, lit on hover.
 *
 * Absolutely placed over the column's right gutter rather than laid in the row
 * beside the label — a 10px mark and its gap is two characters out of a label
 * that already has to fit in 76px, and the gutter is empty. It centres on the
 * label's line rather than sitting at the column's top, since the column is a
 * cell of the rail now and has padding of its own above the text.
 */
function Caret() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-[8px] leading-none text-foreground/30 transition-colors group-hover/col:text-active"
    >
      ▾
    </span>
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
          <span className="text-base font-bold tabular-nums text-foreground/85">
            {cell.held}
          </span>
          <span className="text-[11px] tabular-nums text-foreground/40">
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
            className="text-sm font-bold leading-none tabular-nums text-foreground/85"
          >
            {cell.text}
          </span>
        ) : (
          <span className="text-base font-bold leading-none text-foreground/25">
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
            className={`text-base font-bold tabular-nums ${TIER_TEXT[t.tier]}`}
          >
            #{cell.rank.rank}
          </span>
          <span className="text-[11px] tabular-nums text-foreground/40">
            /{cell.rank.of}
          </span>
        </span>
      ) : (
        <span className="text-base font-bold leading-none text-foreground/25">
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
