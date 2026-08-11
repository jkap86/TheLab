import { shortPlayerName, weekCount } from "../../format";
import { PLAYER_METRICS, PLAYER_METRICS_BY_KEY } from "../../roster-metrics";
import { positionTextTone } from "../position-badge";
import type { SectionLayout } from "./roster-layout";
import type {
  LeagueRosterValues,
  LeagueWeekView,
  PlayerOutlook,
  PlayerSplit,
  PlayerSummary,
} from "./types";

/**
 * One roster row and its number cells, laid out on the section's shared grid
 * (see `roster-layout`). Split out of `roster-detail`, which keeps the sections
 * and the coverage caveat; this file owns everything below a section heading.
 *
 * Every row in a section is drawn alike. It used to tint a starter the optimal
 * lineup promoted and dim a bench player it sat, which read this half as a diff
 * against what Sleeper has seated — but the two lists *are* the best lineup
 * available, so which section a player is in already says where he belongs, and
 * the marking only said how far the team currently is from agreeing.
 *
 * ## A chip is a lineup slot; a position is letters
 *
 * The row used to carry two marks, and they were the *same part*: a rounded,
 * filled, uppercase 9px chip saying `QB`, and directly under it a rounded,
 * filled, uppercase 10px {@link PositionBadge} also saying `QB`. Two of one
 * thing rather than two facts — which is most of why the row read as repeating
 * itself, and it cost a whole line to say so.
 *
 * So the chip is slot vocabulary and nothing else, and the position is letters:
 * toned on the glyphs rather than on a fill, which is a different register at a
 * glance and about half the width (`DEF` is 19px against the badge's fixed 32).
 * Three rules follow, and the third is the one that is easy to lose:
 *
 * - **A bench player has no slot, so he has no chip.** His position takes the
 *   slot lane instead, as letters — so the two sections still line up while
 *   staying visibly different kinds of row.
 * - **The chip carries the position in its wash**, through `currentColor` and
 *   one table (see `.lab-tab-pos` and `positionTextTone`), so the colour scan
 *   the badge was good at survives without the badge.
 * - **The letters are drawn only where the chip does not already say the
 *   position** — a flex, a superflex, and the IDP case where Sleeper starts a
 *   player at `DL` whose position reads `LB`. On a quarterback in the QB slot
 *   they would be the restatement this just removed. It is the rule the trades
 *   board already keeps for a pick's origin: print it when it is a surprise.
 *
 * ## Two shapes, one set of cells
 *
 * Below `@3xl` the row is two lines and from `@3xl` it is one — see
 * `roster-layout` for which widths and why. Every cell below is written once
 * and moves between the two by container query alone:
 *
 * - the **mark** is out of flow below `@3xl` (riding the row's leading corner,
 *   costing the name an indent and the numbers nothing) and in flow from it,
 *   where it is the first cell of the grid and fills the slot lane;
 * - the **name** spans the row's whole first line below `@3xl` and one cell of
 *   it from `@3xl`;
 * - the **meta** cell — the position where it is a surprise, and the NFL team —
 *   is the second line below `@3xl` and is not drawn from it, where both facts
 *   have somewhere better to be.
 *
 * The one thing rendered twice is the position, because it lands in different
 * cells in the two shapes. That is the same pair the contracted and full name
 * are already written as, for the same reason: a container query can move a box
 * but not a string between two of them.
 */

/**
 * Short labels for the slots whose Sleeper names are too long to print.
 *
 * The overlapping flexes have the longest names and are exactly the ones a
 * reader has to tell apart — `WRRB_FLEX` and `REC_FLEX` both truncate to
 * something unreadable, so they get the RB/WR and WR/TE spellings instead.
 *
 * **One table now, where there were two.** A second held `FLX` and `SFX` for the
 * narrow tier, because the slot lived in a fixed 20px track that the four-letter
 * spellings didn't fit — and the two were a matched pair with no compiler link
 * between them, so a label added to one without a width check against the other
 * truncated the one thing on the row that must never truncate. A tab sizes to
 * its own label, so the concession has nothing left to concede to.
 */
const SLOT_LABEL: Record<string, string> = {
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  SUPER_FLEX: "SFLX",
  IDP_FLEX: "IDP",
};

export function PlayerRow({
  player,
  playerId,
  slot,
  outlook,
  split,
  layout,
  columns,
  values,
  weekView,
  horizon = 0,
}: {
  player: PlayerSummary | undefined;
  playerId: string;
  slot?: string;
  outlook?: PlayerOutlook;
  /**
   * How the projection divides between weeks in and out of the lineup. Undefined
   * for a player with no projection at all — the metrics read that as an em dash,
   * a different thing from a real projected 0.00.
   */
  split?: PlayerSplit;
  /**
   * The section's grid. Its column count decides how many numbers this row
   * carries — see `columns` for which metrics they are.
   */
  layout: SectionLayout;
  /**
   * The metric key each value column shows — empty for a league with no numbers
   * at all, which pairs with the `NO_NUMBERS` layout.
   */
  columns: string[];
  /** Per-player KTC and ADP values on this league's board, for the value columns. */
  values: LeagueRosterValues;
  /** The week's numbers, or null on a panel opened on a season. */
  weekView: LeagueWeekView;
  /** Weeks the projection covers, so a partial one can be marked as such. */
  horizon?: number;
}) {
  // Sleeper pads an unfilled starting slot with an empty id or a literal "0".
  const empty = !playerId || playerId === "0";
  const name = empty ? "Empty" : (player?.name ?? playerId);
  // Contracted below @lg, whole above it — see `shortPlayerName` for why the
  // narrow tier can't simply hold the full one. Most names differ between the
  // two, so the pair is rendered rather than branched on at runtime; where they
  // agree, one span is drawn.
  const short = empty ? name : shortPlayerName(name, player?.position ?? null);
  const slotLabel = slot ? (SLOT_LABEL[slot] ?? slot) : null;

  const position = empty ? null : (player?.position ?? null);
  const tone = positionTextTone(position);
  // The letters are worth drawing exactly where the chip doesn't already say
  // the position: a flex of any kind, the IDP slots Sleeper starts a linebacker
  // at `DL` in, and every bench row (which has no chip at all). Comparing the
  // raw slot rather than its label is deliberate — `SLOT_LABEL` shortens
  // `SUPER_FLEX` to `SFLX`, which no position is ever equal to anyway, and the
  // question being asked is about the lineup's vocabulary and not about how it
  // is abbreviated.
  const showPosition = Boolean(position) && slot !== position;

  const ctx = {
    outlook,
    split,
    horizon,
    ktc: values.ktc[playerId] ?? null,
    adp: values.adp[playerId] ?? null,
    adpPosition: values.adp_position[playerId] ?? null,
    superflex: values.superflex,
    draftCount: values.adp_draft_count,
    week: weekView?.week ?? null,
    weekProjection: weekView?.projection[playerId] ?? null,
    ppg: weekView?.ppg[playerId] ?? null,
    ppgSource: weekView?.ppg_source ?? null,
  };

  return (
    // **No rule between rows, and two different things standing in for one.**
    // Forty hairlines down a roster is more drawn furniture than a list this
    // short-lined needs, but something has to say where a row ends — and what
    // that is differs by shape. From `@3xl` the row is one line and the numbers
    // have a lane of their own to track against (see `RosterSection`). Below it
    // the row is a *pair* of lines with no lane, so two adjacent rows would read
    // as one four-line block; the band is what parts them, and it is cheaper
    // than a rule because it is a tone rather than an edge.
    //
    // `@max-3xl:` rather than a plain `odd:` turned off later: two variants of
    // one property are decided by specificity and source order, and
    // `odd:bg-…`/`@3xl:odd:bg-transparent` tie on both — the failure would be a
    // banded one-line list, which looks deliberate and is not.
    //
    // The band bleeds 4px past the row's own box so it reaches the plate's
    // inset rather than floating inside it; `px-1` puts the content back where
    // it was, so nothing moves and no track is re-measured.
    <li className={`relative -mx-1 grid ${layout.grid} items-center gap-x-2 gap-y-0.5 px-1 py-1 @max-3xl:odd:bg-foreground/[0.022] @3xl:gap-y-0 @3xl:py-2`}>
      {/* The mark. A starter's is the *slot* on a chip, washed in the position
          it is filled with; a bench player has no slot, so his is the position
          in letters. Both occupy the same lane from `@3xl`, which is what keeps
          the two sections aligned while leaving them different kinds of row.

          Below `@3xl` the chip is out of flow on the row's leading corner, so it
          costs the row nothing but the name's indent — and the bench's letters
          are not drawn here at all, because down there they ride the meta line
          with the team.

          **`left-0`, not a negative offset.** It used to sit at `-left-1` to
          bleed into the plate's own inset, which cannot work from in here: the
          list is inside a scroll box, and `overflow-y: auto` computes
          `overflow-x` to `auto` as well, so anything reaching past the box's
          leading edge is clipped rather than overhanging. It went unnoticed
          while the widest label had a pixel to spare and showed up the moment
          the chip's padding tightened — as `FLEX` and `SFLX` with their first
          letter shaved off, which reads as a rendering fault rather than as a
          label. */}
      {slotLabel ? (
        <span
          className={`lab-tab lab-tab-pos absolute left-0 top-[2px] inline-flex h-[17px] min-w-[26px] items-center justify-center rounded-[5px] px-1 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.04em] @3xl:static @3xl:top-auto @3xl:w-full ${tone}`}
        >
          {slotLabel}
        </span>
      ) : (
        <span
          className={`hidden text-center font-mono text-[0.62rem] font-bold leading-none tracking-[0.04em] @3xl:block ${tone}`}
        >
          {position ?? ""}
        </span>
      )}

      {/* `title` is the desktop backstop and deliberately not the plan: it does
          nothing on a touch screen, which is the width where the name is short
          of room in the first place. */}
      <span
        title={empty ? undefined : name}
        className={`${layout.nameSpan} flex min-w-0 items-baseline gap-1.5 text-sm ${
          // Clears the chip's overhang, and only while the chip is overhanging:
          // from `@3xl` it is a cell of the grid and pays for its own width.
          slotLabel ? "pl-[34px] @3xl:pl-0" : ""
        } ${empty ? "text-foreground/25" : "text-foreground/85"}`}
      >
        <span className="min-w-0 truncate">
          {short === name ? (
            name
          ) : (
            <>
              <span className="@lg:hidden">{short}</span>
              <span className="hidden @lg:inline">{name}</span>
            </>
          )}
        </span>
        {/* The one-line shape's home for the position, where there is no meta
            line to put it on. It never truncates and the name does, which is
            the right way round: a shortened name still reads as a name. */}
        {showPosition && slotLabel && (
          <span
            className={`hidden shrink-0 font-mono text-[0.62rem] font-bold tracking-[0.04em] @3xl:inline ${tone}`}
          >
            {position}
          </span>
        )}
      </span>

      {/* The second line, below `@3xl` only: what a player *is*, where the line
          above says who he is and the cells beside it say how he is doing.

          The NFL team is back at every width. It used to wait for `@lg` because
          the position badge was spending this line's width — 32px of pill for a
          fact the chip above it had already stated — and with the badge gone
          there is room for both the letters and the team on a 154px phone row. */}
      <span className="col-start-1 flex min-w-0 items-baseline gap-1.5 @3xl:hidden">
        {showPosition && (
          <span
            className={`shrink-0 font-mono text-[0.62rem] font-bold tracking-[0.04em] ${tone}`}
          >
            {position}
          </span>
        )}
        {player?.team && (
          <span className="truncate text-[0.62rem] tabular-nums text-foreground/35">
            {player.team}
          </span>
        )}
      </span>

      {columns.map((key, i) =>
        empty ? (
          // Keep the number columns occupied so an unfilled slot doesn't pull the
          // next row's cells up into its line.
          <span key={i} />
        ) : (
          <PlayerStat key={i} metricKey={key} ctx={ctx} outlook={outlook} horizon={horizon} />
        ),
      )}
    </li>
  );
}

/**
 * One number cell: the selected metric read off this player. Its width comes from
 * the section's grid column rather than the cell, so a heading and the numbers
 * under it can't disagree about it.
 *
 * An em dash for a metric with no answer, dimmed for a real-but-empty number (a
 * projected 0.00, an off-board value), with the short-horizon marker appended when
 * the metric is a projection covering fewer weeks than the horizon.
 */
function PlayerStat({
  metricKey,
  ctx,
  outlook,
  horizon,
}: {
  metricKey: string;
  ctx: Parameters<(typeof PLAYER_METRICS)[number]["cell"]>[0];
  outlook?: PlayerOutlook;
  horizon: number;
}) {
  const metric = PLAYER_METRICS_BY_KEY[metricKey] ?? PLAYER_METRICS[0];
  const cell = metric.cell(ctx);

  return (
    <span
      title={cell.title}
      // Every size here is set by the *widest* total rather than by a typical
      // one — a season projection is eight characters in a high-scoring league
      // (`1,041.16`) — and each is measured against its own track in
      // `roster-layout`, which is where the arithmetic lives. A shortened name
      // still reads as a name where a shortened total reads as bad data.
      //
      // The narrow tier steps *up* rather than down, which is the position
      // badge's width being handed to the figures: these numbers shared their
      // line with a 32px pill until the badge left it.
      className={`text-right text-[0.7rem] tabular-nums @lg:text-xs @3xl:text-[0.8125rem] ${
        cell.text === null || cell.muted ? "text-foreground/25" : "text-foreground/70"
      }`}
    >
      {cell.text ?? "—"}
      {cell.short && outlook && <ShortHorizon outlook={outlook} horizon={horizon} />}
    </span>
  );
}

/**
 * The marker on a total covering fewer weeks than the horizon, so one that looks
 * low can be read as short rather than bad — but only past a week's shortfall.
 *
 * Every team has exactly one bye, so over a rest-of-season horizon a single
 * missing week is what *everyone* looks like, and an asterisk on every row says
 * nothing. Two or more is a hole: a week Sleeper hasn't published, or a player who
 * has fallen off the slate.
 */
function ShortHorizon({
  outlook,
  horizon,
}: {
  outlook: PlayerOutlook;
  horizon: number;
}) {
  if (horizon - outlook.weeks <= 1) return null;

  return (
    <span
      title={`Projected in only ${outlook.weeks} of ${weekCount(horizon)}`}
      className="text-foreground/30"
    >
      *
    </span>
  );
}
