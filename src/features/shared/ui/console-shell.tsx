import type { ReactNode } from "react";

/**
 * The bottom console's **case** — the part `/manager`'s Shares,
 * `/lineupchecker`'s Start / sit and `/gametime`'s Player Scores all stand in.
 *
 * All three are the same object seen from three tools: a billet bar fixed to
 * the foot of the page's own `max-w-6xl` shell, expanding upward into a panel
 * that narrows the grid behind it without a backdrop. They were three
 * hand-copied shells and had drifted into two — one lifted clear of the bottom
 * edge in a framed, fully-rounded ice case, two sitting flush on the fold with
 * no frame at all — so a reader walking between the tools saw one part drawn
 * two ways. This is the shell stated once, on `CONSOLE_ICE_BAR`'s own rule:
 * the alternative is the same chrome hand-copied into three class strings that
 * then drift again.
 *
 * **Flush on the fold, and framed.** The two are not in tension: the case runs
 * to the bottom edge and carries 7px of its own face round the plate inside
 * it, so the bar reads as a part seated in a frame rather than as a strip
 * welded across the foot. The frame is why the closed height is the bar plus
 * **14px** — a caller that forgets it squeezes its own bar — and why the outer
 * radius is a little larger than the bar's (7px of frame around a 14px plate
 * is ~21px, so 22px reads concentric).
 *
 * **The bottom corners are square**, which is what says it sits *on* the edge
 * rather than floating over it. Rounded, they would show the page through two
 * notches at the very foot of the screen.
 *
 * **`pointer-events` is off on the section and back on inside it**: the gutter
 * either side is transparent, and a page that could not be clicked through it
 * would be a hundred cards behind a pane of glass.
 *
 * **The height is the caller's**, because the three do not agree on it and the
 * disagreement is load-bearing — see each console's own note. It is an inline
 * style reading custom properties the caller declares through `className`,
 * which is forced twice over: the animated, positioned box is this section, so
 * a phone arm must reach *it*, and an inline style cannot carry a media query.
 */
export function ConsoleShell({
  label,
  open,
  height,
  className = "",
  children,
}: {
  /** The section's accessible name — what this console is. */
  label: string;
  /** Whether the panel is up. Drives the scrim and nothing else here. */
  open: boolean;
  /**
   * The section's height, as a CSS value. Closed, it must be the bar **plus
   * the frame**: `calc(var(--…-bar-h) + 14px)`.
   */
  height: string;
  /**
   * Lands on the **section**, which is where the custom properties the height
   * reads have to be declared — and where a finish belongs too, since every
   * one of {@link CONSOLE_ICE}'s entries is a declaration and custom
   * properties inherit down to the case and its contents. The caller's
   * `chromeClass` (a parked card stands the page's chrome down) goes here as
   * well.
   */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={`lab-anim pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 transition-[height] duration-[340ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${className}`}
      style={{ height }}
    >
      {/* The page darkens under the part standing over it — `fixed` so it is
          not bounded by the section's own height, behind the case, and
          `pointer-events-none` like the section around it. It is drawn *here*
          rather than beside `ConsoleGround` so it is bounded by this section's
          `z-40`; the day it has to sit under other fixed chrome it moves to
          the page. Transparent at its own top edge, so a console that opens
          only part way leaves the grid it is narrowing legible above it. */}
      {open && (
        <span
          aria-hidden
          className="pointer-events-none fixed inset-x-0 bottom-0 top-[34%] -z-[1] bg-[image:var(--panel-case-ice-scrim)]"
        />
      )}
      <div className="pointer-events-auto relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-t-[1.375rem] bg-[image:var(--panel-case-bg)] p-[7px] shadow-[var(--panel-case-shadow)]">
        {/* The finish: brushed grain, one raking specular, and the milled step
            cut round the face inside the chamfer. Children rather than three
            more background layers, on `BilletFinish`'s own rule — and the step
            is a *shadow* (an inset lip and an outer hairline), which no
            gradient can draw. It rounds at the top alone, with the case. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--billet-grain)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--panel-case-ice-specular)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[4px] rounded-t-[1.1875rem] shadow-[var(--panel-case-ice-step)]"
        />
        {children}
      </div>
    </section>
  );
}
