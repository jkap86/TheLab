import { weekCount } from "../format";
import { PLAYER_METRICS, PLAYER_METRICS_BY_KEY } from "../roster-metrics";
import type {
  LeagueRosterValues,
  PlayerOutlook,
  PlayerSplit,
  PlayerSummary,
} from "../types";
import type { SectionLayout } from "./roster-layout";
import { PositionBadge } from "./ui";

/**
 * One roster row and its number cells, laid out on the section's shared grid
 * (see `roster-layout`). Split out of `roster-detail`, which keeps the sections
 * and the lineup summary; this file owns everything below a section heading.
 */

/**
 * Short labels for the slots whose Sleeper names don't fit the column.
 *
 * The overlapping flexes have the longest names and are exactly the ones a
 * reader has to tell apart — `WRRB_FLEX` and `REC_FLEX` both truncate to
 * something unreadable, so they get the RB/WR and WR/TE spellings instead.
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
  promoted,
  benched,
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
  /** Starting here only in the optimal lineup. */
  promoted?: boolean;
  /** Started today, but sat by the optimal lineup. */
  benched?: boolean;
}) {
  // Sleeper pads an unfilled starting slot with an empty id or a literal "0".
  const empty = !playerId || playerId === "0";
  const name = empty ? "Empty" : (player?.name ?? playerId);

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
    <li
      className={`grid ${layout.grid} items-center gap-x-1 gap-y-0.5 py-1.5 @lg:gap-x-2 ${
        promoted ? "bg-active/[0.07]" : benched ? "opacity-50" : ""
      }`}
    >
      {/* Spans both lines so the slot reads as labelling the whole row, and holds
          the gutter open on bench rows that have no slot to show. */}
      <span className="row-span-2 self-center truncate text-center text-[0.65rem] font-semibold uppercase text-foreground/35 @lg:text-[0.7rem]">
        {slot ? (SLOT_LABEL[slot] ?? slot) : ""}
      </span>

      <span
        className={`${layout.nameSpan} min-w-0 truncate text-sm ${
          empty ? "text-foreground/25" : "text-foreground/85"
        }`}
      >
        {name}
      </span>

      {/* Second line: what the name used to be competing with. The badge no longer
          needs hiding at narrow widths — it isn't taking room from anything now. */}
      <span className="col-start-2 flex min-w-0 items-center gap-1.5">
        {!empty && <PositionBadge position={player?.position ?? null} />}
        {player?.team && (
          <span className="truncate text-[0.65rem] tabular-nums text-foreground/35">
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
          <PlayerStat
            key={i}
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
      className={`text-right text-xs tabular-nums ${
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
