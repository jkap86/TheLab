import { shortPlayerName, weekCount } from "../../format";
import { PLAYER_METRICS, PLAYER_METRICS_BY_KEY } from "../../roster-metrics";
import { PositionBadge } from "../position-badge";
import type { SectionLayout } from "./roster-layout";
import type {
  LeagueRosterValues,
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

  const ctx = {
    outlook,
    split,
    horizon,
    ktc: values.ktc[playerId] ?? null,
    adp: values.adp[playerId] ?? null,
    adpPosition: values.adp_position[playerId] ?? null,
    superflex: values.superflex,
    draftCount: values.adp_draft_count,
  };

  return (
    <li className={`relative grid ${layout.grid} items-center gap-x-2 gap-y-0.5 py-1.5`}>
      {/* Out of flow on the row's leading corner rather than in a track of its
          own — see `.lab-tab` and `roster-layout`. It bleeds into the plate's
          own inset, so it costs this row nothing but the name's indent, and a
          bench row without one costs nothing at all. */}
      {slotLabel && (
        <span className="lab-tab absolute -left-1 top-[2px] inline-flex h-[17px] min-w-[26px] items-center justify-center rounded-[5px] px-[5px] font-mono text-[9px] font-bold uppercase leading-none tracking-[0.04em] text-foreground/60">
          {slotLabel}
        </span>
      )}

      {/* `title` is the desktop backstop and deliberately not the plan: it does
          nothing on a touch screen, which is the width where the name is short
          of room in the first place. */}
      <span
        title={empty ? undefined : name}
        className={`${layout.nameSpan} min-w-0 truncate text-sm ${
          // Clears the tab's overhang, and only on a row that carries one.
          slotLabel ? "pl-[34px]" : ""
        } ${empty ? "text-foreground/25" : "text-foreground/85"}`}
      >
        {short === name ? (
          name
        ) : (
          <>
            <span className="@lg:hidden">{short}</span>
            <span className="hidden @lg:inline">{name}</span>
          </>
        )}
      </span>

      {/* Second line, and the tight one now that both value columns are drawn at
          every width — which is why the NFL team waits for @lg.

          It is the fact to yield, and the reasoning is the standings' own for
          the points-for one half over: what gives is a whole fact rather than
          half of one, and this is the least load-bearing thing on the row —
          the player's name is directly above it and the position badge stays.
          The badge is what a reader is scanning a lineup by, and narrowing that
          instead would take the shared component's padding and type size with
          it for the sake of three characters. */}
      <span className="col-start-1 flex min-w-0 items-center gap-1.5">
        {!empty && <PositionBadge position={player?.position ?? null} />}
        {player?.team && (
          <span className="hidden truncate text-[0.65rem] tabular-nums text-foreground/35 @lg:inline">
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
      // A step down below @lg, and the size is set by the *widest* total rather
      // than by a typical one: a season projection is eight characters in a
      // high-scoring league (`1,041.16`), which is 46px at `text-xs` against a
      // 44px track and 39.7px here. A shortened name still reads as a name
      // where a shortened total reads as bad data.
      className={`text-right text-[0.65rem] tabular-nums @lg:text-xs ${
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
