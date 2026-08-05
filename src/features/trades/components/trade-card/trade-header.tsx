import { formatTradeDate, formatTradeTime } from "./trade-card.utils.ts";

/**
 * Which league a trade happened in, and the instant it went through.
 *
 * The card's leading edge carries the accent rail — the same mark the pinned
 * manager plate wears, so a trade card and the header above it are visibly the
 * same material. It is a flex item rather than an absolute box, since the
 * chamfer is what a leading edge has instead of a corner and the rail has to sit
 * clear of it.
 */
export function TradeCardHeader({
  name,
  completedAt,
}: {
  /** The league's name, or the id standing in until the league list answers. */
  name: string;
  /** Epoch milliseconds, or null for a trade Sleeper filed with no timestamp. */
  completedAt: number | null;
}) {
  return (
    <header className="flex items-center gap-2.5 px-1 pb-2.5">
      <span
        aria-hidden="true"
        className="lab-billet-rail h-4 w-0.5 shrink-0 rounded-sm"
      />
      {/* `h2`: the page's own title is a visually-hidden `h1` (the ledge is what
          leads it on screen), so a card is the next level down and a 3 here
          skipped one. */}
      <h2 className="min-w-0 truncate font-display text-[13px] font-bold uppercase tracking-[0.13em] text-foreground/85 [text-shadow:0_1px_0_rgba(255,255,255,0.12),0_-1px_1px_rgba(0,0,0,0.9)]">
        {name}
      </h2>
      {/* The date and the clock time are two functions and one reading — see
          `formatTradeTime`, which carries its own separator so a trade with no
          timestamp leaves nothing dangling after the words that say so. */}
      <span className="lab-readout ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] tabular-nums text-foreground/60">
        {formatTradeDate(completedAt)}
        {formatTradeTime(completedAt)}
      </span>
    </header>
  );
}
