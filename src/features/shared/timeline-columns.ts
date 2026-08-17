import {
  PLAYER_METRICS,
  PLAYER_METRICS_BY_KEY,
  type PlayerMetricCell,
  type PlayerMetricContext,
} from "./roster-metrics.ts";
import {
  rosterValueTotal,
  TEAM_METRICS,
  TEAM_METRICS_BY_KEY,
  type TeamMetricCell,
  type TeamMetricContext,
} from "./standings-metrics.ts";

/**
 * The panel's own stat columns, read at a past moment.
 *
 * **The history view carries the same selection the panel is showing**, which is
 * the whole of what this is for: a reader who has aimed both tables at KTC and
 * then scrubs back is asking what that roster was worth, and a view that dropped
 * the columns made them press `Now`, read the number, and press back. So the two
 * halves draw the same columns, out of the same two catalogues, off the same
 * stored selection — see `usePersistedColumns`, whose keys are the grain rather
 * than the view, so nothing here has a selection of its own to drift.
 *
 * **What a rewind can answer is a fact about the roster's *composition*, and
 * that is exactly one question: what are these players worth.** A board price is
 * a price of an asset, so summing today's KTC or ADP over the players somebody
 * held then is a real number and the one a rewind is usually opened for — it is
 * how a trade is judged after the fact. Everything else in the two catalogues is
 * a fact about the league *today*: a record and a points-for belong to a season
 * in progress, and a projection is the rest of *this* year solved over the roster
 * as it stands now. Printing any of those beside a roster from March would be
 * attributing today's numbers to a team that no longer exists, which is the claim
 * {@link TimelineRosters} was written not to make.
 *
 * So a metric outside {@link REWINDABLE_METRICS} draws an **em dash with a hover
 * saying why** — this codebase's own spelling for "no answer", and the reason
 * this module gates the key rather than letting the catalogue's own null path
 * handle it: `proj` with no outlook says "No projection", which is true of a
 * league nothing could be projected for and misleading about a moment that
 * cannot have one.
 *
 * Pure and tested: everything it touches is an erased `import type` or one of the
 * two catalogues, which are themselves pure, so the rule about what survives a
 * rewind is asserted rather than left to whoever edits the view.
 */

/**
 * The metric keys either catalogue can still answer for a past roster.
 *
 * One set for both grains, because it is one rule read at two scales: `ktc` and
 * `adp` are a player's price and a roster's sum of the same prices. A key added
 * to a catalogue is **not** rewindable until it is named here, which is the
 * failure worth defaulting to — a new metric quietly reading today's numbers
 * under a past date is invisible on screen, where an em dash is not.
 */
export const REWINDABLE_METRICS: ReadonlySet<string> = new Set(["ktc", "adp"]);

/** The board a past roster is priced against: today's prices, by player id. */
export type TimelineBoard = {
  ktc: Record<string, number>;
  adp: Record<string, number>;
  adp_position: Record<string, number>;
  /** Which KTC/ADP board this league reads — for the metrics' own hovers. */
  superflex: boolean;
  /** How many crawled drafts stood behind the ADP board, for its hover. */
  draftCount: number;
};

/** Nothing priced, which is what the halves draw before the values read lands. */
export const NO_TIMELINE_BOARD: TimelineBoard = {
  ktc: {},
  adp: {},
  adp_position: {},
  superflex: false,
  draftCount: 0,
};

/**
 * The em dash a metric draws when the moment cannot answer it.
 *
 * Named after the *reason* rather than after the metric, because a reader
 * hovering one of these is asking why this column is empty here and full one
 * press away — and the answer is the same for all of them.
 */
function notRewindable(label: string): { kind: "value"; text: null; title: string } {
  return {
    kind: "value",
    text: null,
    title: `${label} is a fact about the league today — press Now to read it`,
  };
}

/**
 * One team column's cell for a roster as it stood.
 *
 * The value metrics are handed a context built from the *past* player ids and
 * today's board, so the number is "what that roster would be worth now" — which
 * is the only honest reading available, since this app stores no price history.
 * `team` is null because there is no standings row at a past moment; the one
 * metric that reads it says so itself.
 */
export function timelineTeamCell(
  key: string,
  playerIds: readonly string[],
  board: TimelineBoard,
): TeamMetricCell {
  const metric = TEAM_METRICS_BY_KEY[key] ?? TEAM_METRICS[0];
  if (!REWINDABLE_METRICS.has(metric.key)) return notRewindable(metric.label);
  return metric.cell(timelineTeamContext(playerIds, board));
}

/**
 * A past roster as the team catalogue reads it.
 *
 * Exported for the columns editor, which previews every metric against one
 * subject — so the preview a reader sees while aiming a column here is the cell
 * this view will actually draw, blanks included. The gate above is deliberately
 * *not* applied to it: a metric outside the rewindable set falls to its own null
 * path, which is an em dash either way.
 */
export function timelineTeamContext(
  playerIds: readonly string[],
  board: TimelineBoard,
): TeamMetricContext {
  return {
    team: null,
    outlook: null,
    ktcTotal: rosterValueTotal(playerIds, board.ktc),
    adpTotal: rosterValueTotal(playerIds, board.adp),
    superflex: board.superflex,
    draftCount: board.draftCount,
    week: null,
    weekProjection: null,
  };
}

/** One roster column's cell for a player as he was held — today's price for him. */
export function timelinePlayerCell(
  key: string,
  playerId: string,
  board: TimelineBoard,
): PlayerMetricCell {
  const metric = PLAYER_METRICS_BY_KEY[key] ?? PLAYER_METRICS[0];
  if (!REWINDABLE_METRICS.has(metric.key)) return notRewindable(metric.label);
  return metric.cell(timelinePlayerContext(playerId, board));
}

/** A held player as the roster catalogue reads it — see {@link timelineTeamContext}. */
export function timelinePlayerContext(
  playerId: string,
  board: TimelineBoard,
): PlayerMetricContext {
  return {
    outlook: undefined,
    split: undefined,
    horizon: 0,
    ktc: board.ktc[playerId] ?? null,
    adp: board.adp[playerId] ?? null,
    adpPosition: board.adp_position[playerId] ?? null,
    superflex: board.superflex,
    draftCount: board.draftCount,
    week: null,
    weekProjection: null,
  };
}

/**
 * The line that tells a reader why their columns are empty here, or null when
 * every one of them still answers.
 *
 * **Only where it is a shortfall**, the rule the header plate's `N of M` keeps:
 * a reader whose columns all rewind is told nothing, because a note saying
 * everything is fine is a permanent band on the plate. It names the columns
 * rather than counting them — there are at most four across the two halves, and
 * "Proj and Bench" is what a reader can act on where "2 columns" is not.
 *
 * Both selections are read together because the caveat sits under both halves,
 * and a duplicate name (each table aimed at KTC) is one mention rather than two.
 */
export function timelineColumnNote(
  teamColumns: readonly string[],
  playerColumns: readonly string[],
): string | null {
  const stranded = new Set<string>();
  for (const key of teamColumns) {
    if (REWINDABLE_METRICS.has(key)) continue;
    stranded.add((TEAM_METRICS_BY_KEY[key] ?? TEAM_METRICS[0]).label);
  }
  for (const key of playerColumns) {
    if (REWINDABLE_METRICS.has(key)) continue;
    stranded.add((PLAYER_METRICS_BY_KEY[key] ?? PLAYER_METRICS[0]).label);
  }
  if (stranded.size === 0) return null;

  const names = [...stranded];
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "reads" : "read"} the league as it stands today, so ${
    names.length === 1 ? "it is" : "they are"
  } blank here — aim a column at KTC or ADP to price these rosters.`;
}
