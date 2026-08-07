"use client";

import dynamic from "next/dynamic";

import type { ColumnPreset, Metric } from "../metric-cell.ts";
import type { SubjectView } from "../subject-view.ts";
import { useColumnsEditor } from "../use-columns-editor";
import type { ColumnsEditor as ColumnsEditorComponent } from "./columns-editor";
import { ListLedge } from "./list-ledge";
import { MetricHeadings } from "./metric-column";
import { SubjectRail } from "./subject-rail";

/**
 * The editor, loaded the first time a heading is pressed.
 *
 * It is a `<dialog>` nobody has opened, so nothing of it is on screen at first
 * paint — but it was in the bundle, and it is not small: four slot previews, the
 * catalogue laid out in captioned bays and the preset row, plus the metric
 * vocabulary behind all of it. Split out, a reader who never re-aims a column
 * never downloads it, and the manager tabs' first paint is the list.
 *
 * `ssr: false` because a dialog that opens on a press has no server-rendered
 * state worth having, and rendering it would put the markup back in the document
 * that this removes.
 *
 * `dynamic` erases the generic — it types its result against `unknown` props —
 * so the loaded component is cast back to what it is. The cast is safe because
 * it names the very module being imported: a prop that changed shape is a type
 * error at the import, not something this hides.
 */
const ColumnsEditor = dynamic(
  () => import("./columns-editor").then((m) => m.ColumnsEditor),
  { ssr: false },
) as typeof ColumnsEditorComponent;

/**
 * The list's stat columns, stated once above it: what each slot holds, and the
 * two ways to change it.
 *
 * The selection has always been list-wide — one pick moves the column on every
 * card — but it was only ever drawn on the cards, which says the opposite: four
 * labels repeated down a hundred rows read as four per-card controls, and
 * changing the board read as four unrelated errands. So the labels are lifted
 * here, where the selection actually lives, and the cards below keep the numbers
 * alone.
 *
 * It is laid on the cards' own geometry — the same left inset, the same trailing
 * gutter, the same column width — so each heading sits over the numbers it names.
 * The 1px transparent border is not a rounding error: the cards carry a border,
 * and without one here every heading would be a pixel out.
 *
 * **It runs the full width of the cards, and `subject` is what makes that
 * legible.** Alignment alone was not enough to say these labels belong to the
 * list: shrink-wrapped to its four columns the rail was a raised island floating
 * over the right of the page, which reads as a control that happens to sit above
 * a list rather than as its header. Spanning the rows with the name column named
 * too, it is the shape a table header has — see {@link MetricHeadings}.
 *
 * **A heading is the only control here — there is no `Columns` chip beside it.**
 * The chip and the menus were two ways to the same board and the chip knew less
 * than the label: it always opened on slot 1, so changing the fourth column was
 * a press to open and a second press to aim at the column already named on
 * screen. Pressing a heading opens the editor armed on that heading's slot,
 * which is the same gesture answering both.
 *
 * **Where a page has one, the subject filter is drawn above the billet as its
 * own part rather than inside it.** This component places the two and owns the
 * clearance between them; {@link SubjectRail} owns what it is made of. They were
 * two storeys of one billet, which is cheaper and was wrong here — see
 * {@link ListLedge} for the rule that came out of it.
 *
 * **It renders them as siblings rather than inside a box of its own, and that is
 * load-bearing.** Over a list the billet pins itself under the app bar, and a
 * sticky element travels only as far as its *own parent's* box — so a wrapper
 * around these two would scroll away and take the rail with it a few pixels
 * later. A fragment puts both in the page's own column, beside the rows, which
 * is the box the rail has to span. The clearance that wrapper used to hold is on
 * the billet's own box now (see {@link ListLedge}'s pinned box), since a
 * `gap` needs the parent this deliberately does not have.
 *
 * **The headings are drawn at every width — they used to drop below `sm` and let
 * the cards grow their own labels back.** That made the same list two different
 * things either side of one breakpoint: a table with a heading rail on a laptop,
 * a stack of cards each naming its own four columns on a phone, which says the
 * selection is a fact about a card when it is a fact about the list. What was
 * actually breaking down there is geometry, not the rail — a card stacks, so its
 * columns take a line of their own — so the rail stacks with it and its columns
 * divide that line exactly as the cards' do, landing over the numbers they name
 * at both widths.
 */
export function ColumnsBar<C>({
  metrics,
  columns,
  subject,
  presets,
  ctx,
  previewLabel,
  view,
  storey,
  headings = true,
  pinned = false,
  fade = true,
  onColumnChange,
  onColumns,
  onReset,
}: {
  metrics: Metric<C>[];
  columns: string[];
  /** What one row of this list is — the heading over the name column. */
  subject: string;
  presets: ColumnPreset[];
  /** The subject the editor previews against — the list's first row, or null. */
  ctx: C | null;
  previewLabel: string | null;
  /**
   * The page's league view, where the *who is in it* filter is to be drawn
   * above the headings.
   *
   * Optional, and this component knows nothing about what the filter *is* — it
   * places {@link SubjectRail} over the billet and lets that piece own its own
   * part. Omitted, this is exactly the heading rail it has always been.
   */
  view?: SubjectView;
  /**
   * An upper storey inside the billet, for a list whose filter is not the
   * page's — the shares sheet, which draws the selection it is editing there
   * rather than a rail of its own (its search lives in the sheet's title bar,
   * and the key that opens it is what a reader pressed to get here).
   *
   * Still a storey rather than a second slab, because in the sheet the two
   * genuinely are one header: the tokens name the rows the list is *about* and
   * there is nothing else on that surface for a part to separate itself from.
   *
   * Mutually exclusive with {@link view}, which would open a second sheet from
   * inside this one.
   */
  storey?: React.ReactNode;
  /**
   * Whether the list has rows for the headings to head.
   *
   * False draws no billet at all — with the subject filter its own part above,
   * there is nothing left in the rail that a reader who has narrowed to zero
   * needs to reach. That was the whole exemption the two-storey billet cost:
   * the storey held the control that emptied the list, so dropping it with the
   * headings took away the only way back. The tab still decides, because what
   * counts as a row is the tab's own grain: leagues here, shares on the other
   * two.
   */
  headings?: boolean;
  /**
   * Whether the billet holds the top while the list scrolls under it — see
   * {@link ListLedge}. True for a list on a page; false inside the shares sheet,
   * which scrolls its own box.
   */
  pinned?: boolean;
  /**
   * Whether the pinned billet's ground fades below itself — see
   * {@link ListLedge}. A page lowers it while one of its rows has pinned an
   * opaque surface flush against the rail.
   */
  fade?: boolean;
  onColumnChange: (slot: number, key: string) => void;
  onColumns: (keys: readonly string[]) => void;
  onReset: () => void;
}) {
  // Which heading opened the editor (and so which slot it opens armed on), plus
  // the latch that keeps the dialog mounted through its own close — see
  // {@link useColumnsEditor}, which the league detail panel's two tables share.
  const { openSlot, open, close, mounted } = useColumnsEditor();

  // Below `sm` the headings take a line of their own, as the cards' columns do —
  // so the rail sits over the numbers it names at both widths. From `sm` up it
  // spans the row, as the cards do. The box that lays that out is `ListLedge`'s,
  // since the billet may still carry a storey above these in the shares sheet.
  const headingCells = headings ? (
    <MetricHeadings
      metrics={metrics}
      columns={columns}
      subject={subject}
      onOpen={open}
    />
  ) : undefined;

  return (
    <>
      {view && <SubjectRail view={view} />}

      {/* No rows and no storey is no billet: a heading rail with nothing to
          head and no control on it is a lit face saying nothing.

          The clearance between the two lit faces rides on the billet's own box
          rather than being a `gap` here — see the note above on why these two
          cannot share one. */}
      {(headingCells || storey) && (
        <ListLedge
          storey={storey}
          headings={headingCells}
          pinned={pinned}
          fade={fade}
        />
      )}

      {mounted && (
      <ColumnsEditor
        metrics={metrics}
        columns={columns}
        presets={presets}
        ctx={ctx}
        previewLabel={previewLabel}
        openSlot={openSlot}
        onClose={close}
        onColumnChange={onColumnChange}
        onColumns={onColumns}
        onReset={onReset}
      />
      )}
    </>
  );
}
