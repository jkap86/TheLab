// The modules rather than the barrel, and relative rather than aliased. Both
// halves are what keep this renderable under the test runner: `@/features/shared`
// reaches the app bar and `next/navigation` through its own exports, and `tsx
// --test` resolves a relative path and not `@/`.
import { formatPoints } from "../../shared/format";
import {
  COLUMN_BOX,
  COLUMN_ROW,
  COLUMN_WIDTH,
} from "../../shared/ui/stat-columns";

import type { LeagueMatchup } from "../types";

/**
 * The four stat columns a lineup row carries: the bench gap, and three still
 * reserved.
 *
 * **What is decided here is the geometry as much as the numbers.** They are laid
 * on {@link COLUMN_BOX} and {@link COLUMN_ROW}, the same constants the manager
 * tool's league cards resolve through, so the headings above sit over the cells
 * below at both widths. Filling the remaining three in is then a matter of
 * handing this a metric catalogue at this page's grain — one league's week —
 * rather than re-laying the row.
 *
 * An empty cell is drawn as a `value` cell with nothing in it, which is
 * deliberately the same em dash the manager columns print for a number they
 * cannot form: this app spells "no answer" one way. The 1px strip under every
 * cell is the meter's height, held so these columns share a baseline with the
 * ones they will become.
 */
export function LineupStatColumns({
  matchup,
}: {
  /** This league's matchup, or undefined where the week isn't stored for it. */
  matchup: LeagueMatchup | undefined;
}) {
  return (
    <div className={`${COLUMN_ROW} divide-x divide-foreground/10`}>
      <div className={`flex flex-col gap-1 ${COLUMN_BOX}`}>
        {/*
          The name, for a reader who can't see the heading rail lining up with
          this column — the same `sr-only` label `MetricColumn` carries, and for
          the same reason: nothing on the row says what `+12.34` measures.
        */}
        <span className="sr-only">{BENCH_GAP_LABEL}</span>
        <BenchGap matchup={matchup} />
      </div>

      {/* The three still to be filled. Hidden from the accessibility tree, and
          this is the honest reading rather than a shortcut: a column holding
          nothing has nothing to announce, so spelling three em dashes per row
          would be noise standing in for information. The headings above are
          hidden with them, for the same reason — there is no number for a name
          to name yet. */}
      {RESERVED_SLOTS.map((slot) => (
        <div
          key={slot}
          aria-hidden="true"
          className={`flex flex-col gap-1 ${COLUMN_BOX}`}
        >
          <span className="text-base font-bold leading-none text-foreground/25">
            —
          </span>
          <span className="h-1 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * What the optimal lineup would add over the one this team is currently
 * starting — the whole of what a lineup checker is for, as one number.
 *
 * It is spelled exactly as the expanded league panel's own `Lineup gap` readout
 * spells it, because it is the same figure at a different grain and one idea
 * written two ways is the drift that costs a reader their footing:
 *
 * - **`+12.34` in amber where there is something to do.** Amber is this app's
 *   needs-attention tone, and this is the one number in the row that is a verdict
 *   rather than a count.
 * - **`set` where the gap is zero**, not `+0.00`. Zero here is a real answer and
 *   a good one — the team is already starting its best lineup — where a run of
 *   `+0.00` down a list reads as numbers that failed to arrive.
 * - **An em dash where there is no projection at all**, which is a different
 *   thing again: a league with no slots or scoring on file, or a week nothing is
 *   stored for. Absent is never zero.
 */
function BenchGap({ matchup }: { matchup: LeagueMatchup | undefined }) {
  const gap = matchup?.projection?.points_left;

  if (gap === undefined) {
    return (
      <>
        <span
          aria-hidden="true"
          className="text-base font-bold leading-none text-foreground/25"
        >
          —
        </span>
        <span className="sr-only">No projection</span>
        <span className="h-1 w-full" />
      </>
    );
  }

  return (
    <>
      <span
        title={BENCH_GAP_TITLE}
        className={`text-sm font-bold leading-none tabular-nums ${
          gap > 0 ? "text-amber-300" : "text-foreground/45"
        }`}
      >
        {gap > 0 ? `+${formatPoints(gap)}` : "set"}
      </span>
      {/* No meter — the gap has no denominator to place it in — but the strip's
          height is held so this column shares a baseline with the reserved ones
          beside it, and with whatever metric they become. */}
      <span className="h-1 w-full" />
    </>
  );
}

/**
 * The headings over those columns, in the list's own billet.
 *
 * **They are cells and not triggers, and so they wear no milled channel.** A
 * heading in the manager tool is pressed — it opens the columns editor armed on
 * its slot — and `.lab-ledge-slot` is what says so, lighting under the cursor.
 * There is nothing to aim here yet: the first column shows one thing and the
 * other three show nothing, so a part that lights and then does nothing is
 * exactly the promise this app's raised/recessed grammar exists to keep. The
 * label sits flat on the face until there is a catalogue behind it.
 *
 * `.lab-ledge-col` stays, because that is the groove between columns rather than
 * the control: without it the divider has a dark cut and no lit far wall, and the
 * rail reads as painted rather than machined.
 */
export function LineupStatHeadings() {
  return (
    <>
      {/* The name column's own heading, inert and drawn from `sm` up only —
          below that the row stacks and these headings take the whole width, so a
          subject label would be naming a line that isn't there. */}
      <span className="hidden min-w-0 flex-1 items-center truncate py-[9px] pl-1 pr-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/75 sm:flex">
        League
      </span>

      <div className={`lab-ledge-col relative px-1.5 py-1.5 ${COLUMN_WIDTH}`}>
        {/* The full words, since the column's own label has to fit in 76px and a
            truncated heading is the only name a column has. */}
        <span
          title={BENCH_GAP_TITLE}
          className="block truncate px-1 py-[3px] text-[10px] font-semibold uppercase tracking-wider text-foreground/90"
        >
          {BENCH_GAP_LABEL}
        </span>
      </div>

      {/* Hidden from the accessibility tree with the cells they head — see
          {@link LineupStatColumns}. */}
      {RESERVED_SLOTS.map((slot) => (
        <div
          key={slot}
          aria-hidden="true"
          className={`lab-ledge-col relative px-1.5 py-1.5 ${COLUMN_WIDTH}`}
        >
          <span className="block truncate px-1 py-[3px] text-[10px] font-semibold uppercase tracking-wider text-foreground/35">
            —
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * The heading over the first column, and the `sr-only` name in every cell of it.
 *
 * One constant for both, so the word a sighted reader lines up with the number
 * and the word a screen reader is handed for it cannot drift. `Bench gap` rather
 * than the panel's `Lineup gap`: this list is read against a bench, and the two
 * words that fit in the column are the two that say which.
 */
const BENCH_GAP_LABEL = "Bench gap";

/** What the column measures, spelled out where there is room to hover. */
const BENCH_GAP_TITLE =
  "Points the best available lineup would add over what this team is starting today";

/**
 * The three columns still to be filled, as slot indices rather than a count so
 * both halves above iterate the same thing.
 */
const RESERVED_SLOTS = [1, 2, 3];
