/**
 * The lit surface a row in a long list wears — league cards, share cards, trade
 * cards. It is the tool cards' glass held to a row's height: the same border,
 * the same backdrop blur, the same lift and cyan-tinted shadow on hover, and the
 * same light sweep. What it does *not* take is the tool cards' corner brackets,
 * which are a card-scale device — four of them on each of a hundred-odd rows
 * reads as noise rather than as an instrument.
 *
 * Kept in one place for the reason `TOOL_CARD_SURFACE` is: three lists wear it,
 * and a row surface that drifts between them is the difference a reader notices
 * without being able to name.
 *
 * The hover payoff is driven by `group-hover`, and `group` is in
 * `LIST_ROW_SURFACE` rather than in the hover half — a row that doesn't lift
 * still holds a {@link RowSheen} whose rail reads the group's hover state.
 */
export const LIST_ROW_SURFACE =
  "group relative rounded-xl border border-foreground/10 " +
  "bg-gradient-to-b from-foreground/[0.06] to-foreground/[0.015] " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_-16px_rgba(0,0,0,0.7)] " +
  "backdrop-blur-sm";

export const LIST_ROW_HOVER =
  "transition-[transform,border-color,box-shadow] duration-300 " +
  "hover:-translate-y-0.5 hover:border-active/35 " +
  "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_22px_48px_-20px_rgba(0,255,229,0.3)] " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/**
 * The two decorations that make a row read as lit rather than merely bordered: a
 * cyan rail down its leading edge — the same mark the pinned manager plate wears,
 * so a row and the header above it are visibly the same material — and the band
 * of light that sweeps across it on hover.
 *
 * **The sweep is clipped by its own box, not by the row's `overflow`.** A stat
 * column's picker menu hangs *below* the row it belongs to, so `overflow-hidden`
 * on the row itself would cut the menu off — which is a bug that only appears
 * once someone opens one. The clip lives on a wrapper that covers the row and
 * nothing else, and it carries the row's corner radius so the band doesn't run
 * past the rounded edge.
 *
 * It must be rendered *before* the row's content, and that content must be
 * positioned (`relative`), or these paint over it: an absolutely positioned
 * sibling sits above static content regardless of source order.
 *
 * `lit` holds the rail at full brightness rather than at rest. A row that has
 * opened into a panel is the one part of the list currently being worked in, and
 * the rail is what the pinned manager plate uses to say the same thing — so the
 * open league reads as lit whether or not the pointer happens to be over it.
 */
export function RowSheen({ lit = false }: { lit?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-sm bg-gradient-to-b from-active/55 to-active/5 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none ${
          lit ? "opacity-100" : "opacity-60"
        }`}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
      >
        <span className="absolute inset-y-0 left-0 w-3/5 -translate-x-[175%] -skew-x-12 bg-gradient-to-r from-transparent via-foreground/10 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[265%] motion-reduce:transition-none" />
      </span>
    </>
  );
}
