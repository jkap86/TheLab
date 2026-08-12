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
 * Every row of a **season** panel is drawn alike. It used to tint a starter the
 * optimal lineup promoted and dim a bench player it sat, which read that half as
 * a diff against what Sleeper has seated — but there the two lists *are* the best
 * lineup available, so which section a player is in already says where he
 * belongs, and the marking only said how far the team currently is from agreeing.
 *
 * A **week** panel is the case that argument does not cover, and {@link advice}
 * is what it needs instead: there the starters list is what the team is actually
 * starting, so which section a player is in says what *is* rather than what
 * should be, and the difference between the two has nowhere else to appear. See
 * {@link RosterDetail} for where the two ends of a swap come from.
 *
 * ## A chip is a lineup slot; the letters beside the name are the player
 *
 * The row used to carry two marks, and they were the *same part*: a rounded,
 * filled, uppercase 9px chip saying `QB`, and directly under it a rounded,
 * filled, uppercase 10px {@link PositionBadge} also saying `QB`. Two of one
 * thing rather than two facts — which is most of why the row read as repeating
 * itself, and it cost a whole line to say so.
 *
 * So the chip is slot vocabulary and nothing else, and what a player *is* —
 * position and NFL team — trails his name as letters: toned on the glyphs
 * rather than on a fill, which is a different register at a glance and still
 * well under the badge's fixed 32px (`DEF` is 21.5px at the 0.7rem these are set
 * in). Three rules follow, and the third is the one that changed most recently:
 *
 * - **A bench player has no slot, so he has no chip**, and the lane he would
 *   wear one in stays empty rather than standing in with his position — so the
 *   two sections' names still start at one x while staying visibly different
 *   kinds of row.
 * - **The chip carries the position in its wash**, through `currentColor` and
 *   one table (see `.lab-tab-pos` and `positionTextTone`), so the colour scan
 *   the badge was good at survives without the badge.
 * - **The position and the team are drawn on every row, at every width.** They
 *   used to be conditional on both counts — the team only in the two-line
 *   shape, the position only where the chip did not already say it — so the
 *   same fact appeared in three different places depending on which row and
 *   which width you were looking at, and a reader scanning for "what is he, and
 *   who does he play for" had to check twice and sometimes got no answer at
 *   all. A quarterback in the QB slot therefore does say `QB` twice, and that
 *   is not the restatement the badge was: the chip is a fact about the
 *   *lineup* (this is the QB slot) and the letters are a fact about the
 *   *player* (he is a quarterback). They agree here and disagree on a flex, on
 *   a superflex, and in the IDP case where Sleeper starts a player at `DL`
 *   whose position reads `LB` — and a column that only speaks up when the two
 *   disagree is a column you cannot read down.
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
 * - the **name**, with the position and the team beside it, spans the row's
 *   whole first line below `@3xl` and one cell of it from `@3xl`. The name is
 *   the only part of that group that truncates, which is the right way round: a
 *   shortened name still reads as a name, where a clipped team code reads as a
 *   different team.
 *
 * There is no meta line any more, which is what leaves the second line of the
 * narrow shape holding numbers alone — see `SectionLayout.statStart` for the
 * one placement that keeps them under the headings that name them.
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

/**
 * What the week's own solve would do with this player, where it disagrees with
 * the lineup he is in.
 *
 * Two values rather than one because a swap has two ends and they sit in two
 * different lists: `sit` is a starter to take out, `start` is the bench player to
 * put in. Absent is the ordinary row and by far the common one — most of a lineup
 * is already right, and a marked row is only worth anything while it is rare.
 */
export type LineupAdvice = "sit" | "start";

/**
 * How each mark is drawn, and the pairing is the app's own rather than a palette.
 *
 * `sit` takes the needs-attention amber, which is the tone this app spends on a
 * verdict rather than a count — the same amber the lineup row's own gap column
 * wears, one tool over, for the same number read at the team's grain. `start` is
 * the accent, because it is not a problem: it is where the amber row's points
 * are, and tinting it amber too would put two alarms on one swap.
 *
 * The tone is on the **name**, not on a badge beside it. At ~120px of name track
 * on a phone a word costs the thing it is marking, and colour is the one signal
 * that survives the width — while the row keeps a `title` and an `sr-only` for
 * the reading colour alone cannot carry.
 */
const ADVICE: Record<LineupAdvice, { name: string; note: string; label: string }> = {
  sit: {
    name: "text-amber-300",
    note: "Better points available from the bench — move him out",
    label: "Swap out: ",
  },
  start: {
    name: "text-active",
    note: "Projected to beat somebody in the lineup — move him in",
    label: "Swap in: ",
  },
};

export function PlayerRow({
  player,
  playerId,
  slot,
  advice,
  reseat,
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
  /**
   * What the week's solve would do with this player, where it disagrees with the
   * lineup he is in. Absent on a season panel, where the list already *is* the
   * best lineup and there is nothing to disagree with — see {@link LineupAdvice}.
   */
  advice?: LineupAdvice;
  /**
   * The seat kickoff order gives this player instead — the same starters, with
   * earlier games in stricter slots and later games in the flexes, so the
   * flexible seats stay open longest. Absent for the common row (most seats
   * don't move), on a season panel, and wherever the week carries no ordering;
   * the caller also withholds it from a `sit` row, since re-seating a player
   * who shouldn't start is polishing the wrong lineup.
   */
  reseat?: string;
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

  // What the player *is*, drawn on every row at every width — see the note
  // above for why this no longer asks whether the chip already says as much.
  // An unfilled slot has neither: there is nobody in it, and a guess would be
  // worse than the em dash's worth of nothing it draws instead.
  const position = empty ? null : (player?.position ?? null);
  const team = empty ? null : (player?.team ?? null);
  const tone = positionTextTone(position);

  // Never on an unfilled slot: there is nobody in it to move, and the solve
  // names players rather than seats.
  const mark = empty || !advice ? null : ADVICE[advice];

  // The kickoff re-seat, in the slot chip's own vocabulary — it names a seat,
  // and two spellings of one slot on one row would read as two slots.
  const move = empty || !reseat ? null : (SLOT_LABEL[reseat] ?? reseat);

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
    <li className={`relative -mx-1 grid ${layout.grid} items-center gap-x-2 gap-y-0.5 px-1 py-1 @max-3xl:odd:bg-foreground/[0.022] @3xl:gap-y-0 @3xl:py-2.5`}>
      {/* The mark, and it is the *slot* on a chip washed in the position it is
          filled with — nothing else. A bench player holds no slot, so the lane
          is left empty rather than standing in with his position: that fact
          rides beside his name now, at every width, and drawing it here as well
          would be the second mark this row was rebuilt to remove. The empty
          cell stays so the two sections' names start at one x.

          Below `@3xl` the chip is out of flow on the row's leading corner, so it
          costs the row nothing but the name's indent — and the lane is not a
          track down there at all, which is why the bench's placeholder is
          `hidden` until the shape switches.

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
        <span aria-hidden="true" className="hidden @3xl:block" />
      )}

      {/* Who he is, then what he is: the name, his position and his NFL team,
          one line at every width. `title` is the desktop backstop for a
          truncated name and deliberately not the plan — it does nothing on a
          touch screen, which is the width where the name is short of room in
          the first place.

          The size steps once, at `@4xl`, and that is the first tier whose name
          track holds a nineteen-character name whole — see `roster-layout` for
          the arithmetic, and for why the tier below it is the tightest on this
          half whatever size the name is set in. */}
      <span
        title={mark ? `${name} — ${mark.note}` : empty ? undefined : name}
        className={`${layout.nameSpan} flex min-w-0 items-baseline gap-1.5 text-[0.9375rem] @4xl:text-base ${
          // Clears the chip's overhang, and only while the chip is overhanging:
          // from `@3xl` it is a cell of the grid and pays for its own width.
          slotLabel ? "pl-[34px] @3xl:pl-0" : ""
        } ${
          mark
            ? `${mark.name} font-semibold`
            : empty
              ? "text-foreground/25"
              : "text-foreground/85"
        }`}
      >
        {/* What the colour means, for a reader who cannot see it — and what the
            `title` says for one who cannot hover. `sr-only` is out of flow, so
            it costs the name track nothing; it leads because that is the order
            the sentence reads in. */}
        {mark && <span className="sr-only">{mark.label}</span>}
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
        {/* Both `shrink-0`, so the name is the only thing that gives: a
            shortened name still reads as a name, where `LAR` clipped to `LA`
            reads as a different team. */}
        {position && (
          <span
            className={`shrink-0 font-mono text-[0.7rem] font-bold tracking-[0.04em] ${tone}`}
          >
            {position}
          </span>
        )}
        {team && (
          <span className="shrink-0 text-[0.7rem] text-foreground/35">{team}</span>
        )}
        {/* The kickoff re-seat: same starter, different seat, so the flexes
            lock last. The accent rather than amber — it is an available move,
            not points being lost, and the amber on this list already means
            exactly that. `shrink-0` like the position and team beside it: the
            name is the only thing that gives, and a clipped seat name would
            send a reader to the wrong slot. */}
        {move && (
          <span
            title={`Kickoff order — seat him at ${move} and the more flexible slot stays open for the later game`}
            className="shrink-0 font-mono text-[0.7rem] font-bold tracking-[0.04em] text-active/80"
          >
            <span className="sr-only">Re-seat at </span>
            <span aria-hidden="true">{"→ "}</span>
            {move}
          </span>
        )}
      </span>

      {columns.map((key, i) =>
        empty ? (
          // Keep the number columns occupied so an unfilled slot doesn't pull the
          // next row's cells up into its line.
          <span key={i} className={i === 0 ? layout.statStart : undefined} />
        ) : (
          <PlayerStat
            key={i}
            className={i === 0 ? layout.statStart : ""}
            metricKey={key}
            ctx={ctx}
            outlook={outlook}
            horizon={horizon}
          />
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
  className = "",
}: {
  metricKey: string;
  ctx: Parameters<(typeof PLAYER_METRICS)[number]["cell"]>[0];
  outlook?: PlayerOutlook;
  horizon: number;
  /** The section's placement for this cell, where it needs one — `statStart`. */
  className?: string;
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
      className={`${className} text-right text-[0.7rem] tabular-nums @lg:text-xs @3xl:text-[0.8125rem] ${
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
