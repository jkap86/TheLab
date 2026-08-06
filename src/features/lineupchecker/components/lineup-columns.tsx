// The module rather than the barrel, and relative rather than aliased. Both
// halves are what keep this renderable under the test runner: `@/features/shared`
// reaches the app bar and `next/navigation` through its own exports, and `tsx
// --test` resolves a relative path and not `@/`.
import {
  COLUMN_BOX,
  COLUMN_ROW,
  COLUMN_WIDTH,
} from "../../shared/ui/stat-columns";

/**
 * The four stat columns a lineup row carries — reserved, and blank until there
 * is something to put in them.
 *
 * **What is decided here is the geometry, not the numbers.** They are laid on
 * {@link COLUMN_BOX} and {@link COLUMN_ROW}, the same constants the manager
 * tool's league cards resolve through, so the headings above sit over the cells
 * below at both widths and the row is already the shape the finished tool needs.
 * Filling them in is then a matter of handing this a metric catalogue at this
 * page's grain — one league's week — rather than re-laying the row.
 *
 * The cell is drawn as a `value` cell with nothing in it, which is deliberately
 * the same em dash the manager columns print for a number they cannot form: this
 * app spells "no answer" one way, and a placeholder that invented a second
 * spelling would have to be found and undone later. The 1px strip under it is the
 * meter's height, held so these columns share a baseline with the ones they will
 * become.
 */
export function LineupStatColumns() {
  return (
    // Hidden from the accessibility tree, and this is the honest reading rather
    // than a shortcut: a column holding nothing has nothing to announce, so
    // spelling four em dashes per row would be noise standing in for
    // information. The headings above are hidden with them, for the same reason
    // — there is no number for a name to name yet. Both come back the moment
    // these cells hold a metric, and the `sr-only` label per column that the
    // manager's `MetricColumn` carries is what they come back as.
    <div aria-hidden="true" className={`${COLUMN_ROW} divide-x divide-foreground/10`}>
      {SLOTS.map((slot) => (
        <div key={slot} className={`flex flex-col gap-1 ${COLUMN_BOX}`}>
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
 * The headings over those columns, in the list's own billet.
 *
 * **They are cells and not triggers, and so they wear no milled channel.** A
 * heading in the manager tool is pressed — it opens the columns editor armed on
 * its slot — and `.lab-ledge-slot` is what says so, lighting under the cursor.
 * There is nothing to aim yet, and a part that lights and then does nothing is
 * exactly the promise this app's raised/recessed grammar exists to keep. So the
 * label sits flat on the face until it names something.
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

      {/* Hidden from the accessibility tree with the cells they head — see
          {@link LineupStatColumns}. */}
      {SLOTS.map((slot) => (
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
 * Four, the same number of stat columns the league cards carry.
 *
 * An array of slot indices rather than a count, so both halves above iterate the
 * same thing and a fifth column is one edit in one place.
 */
const SLOTS = [0, 1, 2, 3];
