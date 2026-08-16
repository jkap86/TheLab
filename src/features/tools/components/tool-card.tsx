/**
 * The glass card surface every tool card shares — the live link and the
 * disabled, account-less one. Kept in one place so a change to the card look
 * can't drift between them (the same reason `ShareList` owns its grid template
 * once).
 *
 * The hover payoff — the lit edge, the light sweep, the bracket glow, the
 * growing accent rule — is driven by `group-hover`, so it only fires where the
 * caller adds `TOOL_CARD_HOVER` (which includes `group`). A disabled card takes
 * `TOOL_CARD_SURFACE` alone and stays still.
 */
export const TOOL_CARD_SURFACE =
  "relative flex h-full flex-col overflow-hidden rounded-2xl border border-foreground/12 " +
  "bg-foreground/[0.04] p-6 backdrop-blur-xl shadow-[0_24px_60px_-34px_rgba(0,0,0,0.7)]";

export const TOOL_CARD_HOVER =
  "group transition-[transform,border-color,background-color,box-shadow] duration-300 " +
  "hover:-translate-y-1 hover:border-active/50 hover:bg-foreground/[0.06] " +
  "hover:shadow-[0_34px_74px_-36px_rgba(0,255,229,0.45)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60";

/** One corner tick of the instrument frame; `sides` picks which two borders. */
function Bracket({ position, sides }: { position: string; sides: string }) {
  return (
    <span
      aria-hidden
      className={`absolute z-20 h-2.5 w-2.5 border-active/40 transition-[border-color,box-shadow] duration-300 group-hover:border-active group-hover:shadow-[0_0_7px_var(--color-active)] ${position} ${sides}`}
    />
  );
}

/**
 * The inner content of a tool card: corner brackets, the light-sweep, the tool
 * name in the display face, the "go" chevron, an accent rule that grows across
 * the card on hover, and the description. No icon and no code label — the name
 * carries the card.
 *
 * Every card is a link now (the pick tracker's league picker moved to its own
 * page), so there is no slot below the description and no card without the
 * chevron.
 */
export function ToolCardContent({
  text,
  description,
}: {
  text: string;
  description: string;
}) {
  return (
    <>
      {/* A band of light that sweeps across the glass on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-3/5 -translate-x-[175%] -skew-x-12 bg-gradient-to-r from-transparent via-foreground/10 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[265%]"
      />
      <Bracket position="left-3 top-3" sides="border-l border-t" />
      <Bracket position="right-3 top-3" sides="border-r border-t" />
      <Bracket position="bottom-3 left-3" sides="border-b border-l" />
      <Bracket position="bottom-3 right-3" sides="border-b border-r" />

      <span className="relative z-10 flex items-center gap-3">
        <span className="font-display text-xl font-semibold tracking-tight text-balance">
          {text}
        </span>
        <span
          aria-hidden
          className="ml-auto text-foreground/40 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-active"
        >
          →
        </span>
      </span>

      {/* The accent rule: a short cyan hairline that extends full-width on hover. */}
      <span
        aria-hidden
        className="relative z-10 mt-3 block h-px max-w-[5.75rem] bg-gradient-to-r from-active/60 to-transparent transition-[max-width] duration-500 ease-out group-hover:max-w-full"
      />

      <p className="relative z-10 mt-4 text-sm text-foreground/60">{description}</p>
    </>
  );
}
