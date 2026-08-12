import { formatPoints } from "../shared/format.ts";
import type { ColumnPreset, Metric } from "../shared/metric-cell.ts";
import type { LeagueMatchup } from "./types.ts";

/**
 * The metrics a lineup row can show in each of its stat columns, and how to read
 * one off this league's matchup for the week on screen.
 *
 * **A sixth grain, beside the five in the catalogue table**: `league-metrics` is
 * one league over a season, `standings-metrics` one team, `roster-metrics` one
 * player, `share-metrics` one subject across several leagues and `trade-metrics`
 * one side of one trade. Here a row is **one league's week** — which is why the
 * record and the rankings those catalogues offer have no place in it, and why the
 * one number in it is a fact about a lineup rather than about a season.
 *
 * The columns were hand-drawn before this: a bench-gap cell and three reserved
 * slots that could not be aimed, with a heading rail that deliberately wore no
 * milled channel because there was nothing behind a press. The catalogue is what
 * makes those headings triggers, and the geometry is unchanged — the cells are
 * {@link MetricColumns} and the headings {@link MetricHeadings}, the same two
 * pieces the manager tool's lists resolve through, so a heading still sits over
 * the number it names at both widths.
 *
 * Pure and free of runtime imports beyond {@link formatPoints} — the matchup
 * arrives as an erased `import type` — the same bar its five siblings hold, so
 * the accessors can be tested without a fetch behind them.
 */

/** What a lineup metric reads from: this league's matchup for the week shown. */
export type LineupMetricContext = {
  /**
   * This league's matchup, or null where the week isn't stored for it.
   *
   * Null rather than `undefined` — which is how it arrives off the payload's
   * league map — because a catalogue reads a *context* rather than a lookup, and
   * "not stored" is an answer this has to spell either way.
   */
  matchup: LeagueMatchup | null;
};

/** One selectable lineup metric — {@link Metric} bound to this grain. */
export type LineupMetric = Metric<LineupMetricContext>;

/** What every cell prints where the league can't be projected at all. */
const NO_PROJECTION = "No projection for this week";

/**
 * Every metric a lineup column can show.
 *
 * One real entry so far, plus the blank a column opens on. They share a bay
 * rather than being grouped, since a caption per family is what makes a dozen
 * metrics scannable and two of them under two captions is two captions.
 */
export const LINEUP_METRICS: LineupMetric[] = [
  {
    key: "vs_optimal",
    label: "Vs optimal",
    /**
     * What this lineup projects **against** the best one still reachable —
     * `current − optimal`, so a lineup with points on its bench reads negative.
     *
     * It is the same figure the expanded panel's `Lineup gap` readout carries and
     * the opposite sign: this column answers "where is this lineup" rather than
     * "what is there to gain", so the shortfall is a debt against the best
     * available rather than a bonus on offer, and it is spelled the way a
     * shortfall is spelled everywhere else — with a minus in front of it.
     *
     * Three readings, and the distinctions are the app's own:
     *
     * - **`-12.34` in amber where there is something to do.** Amber is the
     *   needs-attention tone and this is the one number on the row that is a
     *   verdict rather than a count — see {@link MetricTone}. It only ever names
     *   a move that can still be made: a slot whose game has been played is held
     *   rather than re-solved, so the number never asks for a swap Sleeper would
     *   refuse.
     * - **`set` where it is zero**, not `-0.00`. Zero is a real answer and a good
     *   one — the team is already starting the best lineup available — where a
     *   run of `-0.00` down a list reads as numbers that failed to arrive.
     * - **An em dash where there is no projection at all**, which is a different
     *   thing again: a league with no slots or scoring on file, or a week nothing
     *   is stored for. Absent is never zero.
     *
     * It is derived from `points_left` rather than subtracting the two totals
     * here, so the zero this prints `set` for is the server's own zero: the route
     * has already decided the lineup is optimal, and a second subtraction is a
     * second chance to land a hair either side of it.
     */
    cell: ({ matchup }) => {
      const projection = matchup?.projection ?? null;
      if (!projection) return { kind: "value", text: null, title: NO_PROJECTION };

      const behind = -projection.points_left;
      const starting = formatPoints(projection.current);
      return {
        kind: "value",
        text: behind === 0 ? "set" : formatPoints(behind),
        tone: behind < 0 ? "alert" : undefined,
        title:
          behind === 0
            ? `Starting ${starting}, which is the best lineup still reachable`
            : `Starting ${starting} against ${formatPoints(
                projection.optimal,
              )} still reachable — ${formatPoints(
                projection.points_left,
              )} to be had by moving somebody`,
      };
    },
  },
  {
    key: "blank",
    /**
     * A column showing nothing, and the metric three of the four slots open on.
     *
     * **It is named rather than drawn as an em dash, because the heading is a
     * control now.** The reserved columns used to head themselves with a dash and
     * were hidden from the accessibility tree outright, which was the honest
     * reading while there was nothing behind the press: a column holding nothing
     * has nothing to announce. A pressable channel changes that — a reader has to
     * be able to tell an empty column from a broken one, and to read the word
     * before pressing it — so the cell keeps its em dash (this app spells "no
     * answer" one way) and the *heading* says what the column is.
     *
     * Being pickable is what makes it worth having beyond the default board: it
     * is the only way to give a column back once one has been aimed.
     */
    label: "Blank",
    cell: () => ({
      kind: "value",
      text: null,
      title: "No metric — press this column's heading to pick one",
    }),
  },
];

/**
 * The four columns a lineup row opens with: what each lineup is giving up
 * against its best, and three columns left for the metrics this grain has yet to
 * grow.
 *
 * Three slots holding one key is legitimate and the columns machinery is written
 * for it — `assignColumn` swaps a slot with whichever slot held the metric it is
 * being pointed at, and the editor asks what the *armed* slot holds rather than
 * where a key first appears, so arming the third blank lights the entry a reader
 * pressed a blank heading to reach.
 */
export const DEFAULT_LINEUP_COLUMNS: string[] = [
  "vs_optimal",
  "blank",
  "blank",
  "blank",
];

/**
 * The boards this list's editor offers, which is none of them yet.
 *
 * A preset is a *named set of columns* — a question a reader arrives with, spelled
 * as one press instead of four — and with one metric in the catalogue there is no
 * second board to name: the only set expressible is the default, which the
 * editor's own Reset already hands back. It is exported empty rather than left to
 * the call site so the presets live beside the catalogue they name, which is where
 * the first real one will want to be written.
 */
export const LINEUP_COLUMN_PRESETS: ColumnPreset[] = [];
