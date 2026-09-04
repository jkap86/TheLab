import type { ReactNode } from "react";

import { Avatar } from "../avatar";
import { CONSOLE_PLATE } from "../console-chrome";

/**
 * The plates that straddle a console card's top edge.
 *
 * Every league card in the app now carries the same header: the league on the
 * left, one instrument reading on the right — a trade's timestamp, a manager's
 * record and ranks, a week's projected outcome. The plates are the same object
 * on all three, so they live here rather than being copied into three features,
 * on the line that moved `CONSOLE_KEY` and `ManagerPlate`: a second reader.
 *
 * **One flex row, never two absolutely-positioned spans.** `trade-card.tsx`
 * found this at 390px, where the date is nearly as wide as the card: laid out
 * independently the two plates overlap and the league name runs straight under
 * the date. In a row the right plate keeps its width and the name truncates,
 * which is the right way round — a clipped league name is still readable, a
 * clipped date is not.
 */

/**
 * The row itself, hung off the card's top edge.
 *
 * `-top-[13px]` against the card's `1.875rem` (30px) top padding is what leaves
 * the plate half on the bezel and half above it. The row is `absolute`, so the
 * card's own first child starts at the padding rather than under the plate.
 */
export function CardPlateRow({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -top-[13px] left-5 right-5 flex items-center gap-2.5">
      {children}
    </div>
  );
}

/**
 * The league, as a plate: a lit mark and the league's name.
 *
 * **This is the card's subject.** On the manager and lineup checker cards it
 * replaces a 1.75rem engraved headline, which is the single biggest change in
 * the console-card redesign — a plate is what makes those cards read as the
 * same object as a trade card.
 *
 * `size` is the two sizes the design uses and nothing more: `lg` where the
 * league is the whole subject of the card (manager, lineup checker) and `md` on
 * a trade card, where the subject is the trade and the league is where it
 * happened.
 */
export function LeaguePlate({
  name,
  avatarUrl,
  size = "lg",
}: {
  name: string;
  avatarUrl: string | null | undefined;
  size?: "md" | "lg";
}) {
  return (
    <span
      className={`${CONSOLE_PLATE} inline-flex min-w-0 items-center gap-2.5 py-1.5 pl-[5px] pr-4`}
    >
      <LeagueMark name={name} url={avatarUrl} />
      <span
        className={`min-w-0 truncate font-mono uppercase text-foreground/95 ${
          size === "lg"
            ? "text-base tracking-[0.08em]"
            : "text-sm tracking-[0.1em]"
        }`}
      >
        {name}
      </span>
    </span>
  );
}

/**
 * The league's avatar in a lit ring — the one piece of the plate that glows.
 *
 * The ring is the wrapper's, not the image's: `Avatar` draws a face and the
 * bezel around it belongs to whatever mounts it, which is how the same
 * component sits in `ManagerPlate`'s much larger bezel. A league with no
 * avatar on file falls back to its initial drawn *on the glass* — readout
 * text with the readout's own glow — rather than to `Avatar`'s grey letter,
 * because an unlit letter inside a lit ring reads as a failed image.
 */
function LeagueMark({ name, url }: { name: string; url: string | null | undefined }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-active/35 bg-[image:var(--readout-bg)] shadow-[inset_0_0_14px_var(--accent-glow),0_0_14px_-4px_var(--accent-glow)]"
    >
      {url ? (
        <Avatar url={url} name={name} size="sm" />
      ) : (
        <span className="font-mono text-[0.6875rem] text-readout [text-shadow:var(--readout-text-glow)]">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * The right-hand plate: one or more readings, on the same chrome as the league.
 *
 * `tight` exists for the lineup checker's win/loss pip, which is round and
 * needs less plate to the right of it than a run of text does.
 */
export function ReadingPlate({
  children,
  tight = false,
}: {
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <span
      className={`${CONSOLE_PLATE} ml-auto inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap py-1.5 pl-4 ${
        tight ? "pr-[7px]" : "pr-4"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * One field of a reading plate: a small etched label and its figure.
 *
 * The label is drawn at the plate's own weight rather than the readout's — it
 * is stamped into the metal, not lit — which is what keeps the figure beside it
 * the only thing on the plate a reader's eye lands on.
 */
export function PlateField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline gap-[5px]">
      <span className="font-mono text-[0.5rem] uppercase tracking-[0.18em] text-foreground/[0.42]">
        {label}
      </span>
      <span className="font-mono text-[0.8125rem] font-medium tabular-nums text-foreground/[0.97]">
        {children}
      </span>
    </span>
  );
}

/**
 * The milled divider between two fields of one plate.
 *
 * `--groove` and its highlight rather than a hand-written pair, because it is
 * the same cut the console makes everywhere else and it already inverts for
 * light mode.
 */
export function PlateDivider() {
  return (
    <span
      aria-hidden
      className="h-[13px] w-px bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
    />
  );
}

/**
 * The hairline under a card's plate row.
 *
 * It grows on hover, which is the affordance the glass cards had and the one
 * thing about them worth keeping: the handoff draws it static at its full
 * 92px and says the growth may stay.
 *
 * Both readers are a `<details class="group/card">`, which is what the open and
 * hover states here are written against — the trade card has no disclosure and
 * draws no rule.
 */
export function CardRule() {
  return (
    <span
      aria-hidden
      className="relative block h-px w-9 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] group-hover/card:w-[5.75rem] group-hover/card:from-active/90 group-open/card:w-[5.75rem] group-open/card:from-active/90 pointer-fine:[transform:translateZ(36px)]"
    />
  );
}

/**
 * The scanline overlay every lit window carries.
 *
 * A child rather than a second background, for the reason `CONSOLE_READOUT`
 * gives: CSS cannot spell a repeating overlay as a second background on an
 * element that already has a gradient one.
 */
export function Scanlines() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
    />
  );
}
