import type { LeagueRank } from "./types";

/**
 * What a pickable stat column reads and renders — the vocabulary the metric
 * catalogues speak and {@link MetricColumn} draws.
 *
 * It lives apart from any one catalogue because there is now more than one grain
 * behind those columns: a league card reads {@link LEAGUE_METRICS}, a share card
 * reads {@link SHARE_METRICS}, and both are drawn by the same column. Left in
 * `league-metrics` this type would have made the share catalogue import the
 * league one for a shape that is about neither.
 *
 * Three cell shapes, and the difference between them is what the number can be
 * placed against:
 *
 * - A **rank** is `#N of M` — tinted and metered by where in its league it falls,
 *   because a rank has a field to sit in.
 * - A **share** is `N of M` where more is more — held leagues out of the ones
 *   counted, dynasty leagues out of the ones holding him. Metered by the plain
 *   fraction and never tinted: a player in 8 of 121 leagues is not a *bad* result
 *   the way 8th of 12 is, so a rank's tiering would paint most of the list red.
 * - A **value** is a formatted number with nothing to place it in at all.
 *
 * Pure and free of runtime imports — {@link LeagueRank} arrives as an erased
 * `import type` — the same bar the catalogues that use it hold.
 */
export type MetricCell =
  | { kind: "rank"; rank: LeagueRank | null; title: string }
  | { kind: "share"; held: number; of: number; title: string }
  | { kind: "value"; text: string | null; title: string };

/**
 * One selectable metric: its key, its short column label, and how to read it off
 * a context of whatever grain the catalogue is written for.
 *
 * Generic in that context rather than one type per catalogue, so the column that
 * renders a metric and the picker that lists them are written once — the league
 * catalogue binds `C` to a league's ranks and values, the share catalogue to a
 * row's leagues and board price.
 */
export type Metric<C> = {
  /** Stable id, stored as a column's selection and keyed in the picker. */
  key: string;
  /** The uppercase column heading — kept short enough to sit in a stat column. */
  label: string;
  /**
   * The family this metric belongs to, as the columns editor captions it.
   *
   * A flat list hides what the catalogues actually are: twelve league metrics
   * are four families, and several of the entries are one number in two shapes
   * (`proj` beside `proj_pts`). Naming the family is what lets the editor lay
   * them out in bays a reader can scan, and it stays a field on the metric so
   * the catalogue remains one ordered array to add to rather than two lists that
   * can disagree about where a new metric goes.
   */
  group?: string;
  /** Reads this metric off one subject's context into a renderable cell. */
  cell: (ctx: C) => MetricCell;
};

/**
 * A named set of four columns — a whole board rather than one slot.
 *
 * The four slots read as four independent choices and are usually not: a reader
 * arrives with a question ("what are these rosters worth"), and a question is a
 * set of columns. A preset is that set given the name of its question, so the
 * editor can offer it as one press instead of four.
 *
 * It lives beside its catalogue, so the keys are checked against the same list
 * the columns resolve through — a preset naming a metric a catalogue doesn't
 * hold falls back per slot, which is what lets the share presets serve both the
 * players list and the leaguemates one.
 */
export type ColumnPreset = {
  name: string;
  columns: string[];
};

/** A metric's compact value for the picker menu: `#N` for a rank, the number otherwise. */
export function metricPreview(cell: MetricCell): string {
  if (cell.kind === "rank") return cell.rank ? `#${cell.rank.rank}` : "—";
  if (cell.kind === "share") return `${cell.held}`;
  return cell.text ?? "—";
}
