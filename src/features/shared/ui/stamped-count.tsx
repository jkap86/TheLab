import type { ReactNode } from "react";

/**
 * One count stamped into a billet: a label and its figure on one baseline, in
 * the milled well they share with whatever is counted beside them.
 *
 * It was `season-summary.tsx`'s own `Count` until the lineup checker's header
 * took the billet: two spellings of a stamped count is a header whose two
 * tools set the same reading in different type, and `Proj rec` on
 * `/lineupchecker` has to be the same object as `Record` on `/manager`. So it
 * lives here, beside the plates and the ledge, on the line every other shared
 * part moved on — a second reader.
 *
 * A `<dl>` per count rather than one list holding several, because the cut
 * between two of them is not list content: a definition list may hold only
 * `dt`, `dd` and the `div`s grouping them. One name and one value is exactly
 * what a `<dl>` is for, so two of them is the reading that keeps the semantics
 * without wrapping a milled hairline in a group it does not belong to.
 *
 * **`tone` is a colour, not a state**, on `StandingBay`'s terms: the caller
 * knows what the figure says and this only knows how a figure on metal is cut.
 * The default is the billet's own figure ink; the attention count hands over
 * `var(--error)` above zero and nothing at zero. The engraving is
 * `--standing-engrave` either way — a token because its layers invert for light
 * mode — and it goes through `style` for the same reason `StandingBay`'s does:
 * a `text-shadow` is a comma list and a continuous colour has no utility.
 *
 * `live` puts `aria-live="polite"` on the figure, for a count that lands after
 * the page does — the attention count is `—` until the check answers, and the
 * answer should be announced when it arrives rather than found. `title` is the
 * whole sentence for a figure whose spelling is a ratio (`3 / 12`).
 *
 * **`children` is a node rather than a string, and `centred` is what that
 * costs.** A count is type on a baseline, which is what the row is aligned on;
 * a count that has not landed is now a *drawn* object — the bubbling flask —
 * and an object has no baseline worth aligning a label to. Left on
 * `items-baseline` the flask hangs its bottom edge on the label's baseline and
 * the label sits level with the vessel's base. It is a boolean rather than a
 * `className` because a second `self-*` utility in one class attribute is
 * settled by Tailwind's emit order rather than by the caller — the trap
 * `CONSOLE_KEY_PILL` and `CONSOLE_CARD_SHELL` are both split to keep a part out
 * of.
 */
export function StampedCount({
  label,
  tone,
  live = false,
  title,
  centred = false,
  children,
}: {
  label: string;
  /** The figure's ink, as a CSS colour; the billet's own figure ink by default. */
  tone?: string;
  /** Announce the figure when it changes — for a count the page waits on. */
  live?: boolean;
  title?: string;
  /** The figure is a drawn object rather than type — see the module note. */
  centred?: boolean;
  children: ReactNode;
}) {
  return (
    <dl
      className="m-0 flex items-baseline justify-between gap-3 lg:gap-4"
      title={title}
    >
      <dt className="whitespace-nowrap font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
        {label}
      </dt>
      {/* `nowrap`: the en dash in `8–5` is a line-break opportunity, and a
          record split across two lines reads as two numbers. */}
      <dd
        aria-live={live ? "polite" : undefined}
        className={`m-0 whitespace-nowrap font-display text-[length:var(--fs-21)] font-semibold leading-[1.1] tracking-[-0.015em] tabular-nums [text-shadow:var(--standing-engrave)] ${
          centred ? "self-center" : ""
        }`}
        style={{ color: tone ?? "var(--billet-figure)" }}
      >
        {children}
      </dd>
    </dl>
  );
}
