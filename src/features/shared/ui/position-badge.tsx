/**
 * One hue per position, as a fill and as a text colour.
 *
 * **A pair rather than two tables**, because the two halves are read from
 * different places and would drift the moment either moved: the badge below
 * wears both, and the league detail panel's roster wears only the `text` — its
 * slot chip is toned through `currentColor` (see `.lab-tab-pos`) and its
 * position letters are the glyphs themselves. A position that reads emerald on
 * a shares card and sky on a roster row is one palette with two spellings,
 * which is the drift a single table exists to stop.
 */
export const POSITION_TONE: Record<string, { bg: string; text: string }> = {
  QB: { bg: "bg-rose-500/15", text: "text-rose-300" },
  RB: { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  WR: { bg: "bg-sky-500/15", text: "text-sky-300" },
  TE: { bg: "bg-amber-500/15", text: "text-amber-300" },
  K: { bg: "bg-violet-500/15", text: "text-violet-300" },
  DEF: { bg: "bg-teal-500/15", text: "text-teal-300" },
};

/** The tone for a position off the board, or an unsynced one. */
export const UNKNOWN_POSITION_TONE = { bg: "bg-foreground/5", text: "text-foreground/40" };

/** Just the text half, which is what a caller drawing no pill needs. */
export function positionTextTone(position: string | null): string {
  return (position && POSITION_TONE[position]?.text) || UNKNOWN_POSITION_TONE.text;
}

/**
 * A position pill, colour-coded by position.
 *
 * **It is not drawn in the league detail panel's roster**, and that is worth
 * knowing before adding it back: a roster row already carries a lineup slot on
 * a chip, and a second filled, rounded, uppercase 10px mark directly under it
 * read as two of one thing rather than as two facts. There a chip means a
 * lineup slot and the position is letters. Here — the shares lists — the badge
 * is the only mark on the row and has nothing to be confused with, so it stays.
 */
export function PositionBadge({
  position,
  className = "inline-flex",
}: {
  position: string | null;
  className?: string;
}) {
  const tone = (position && POSITION_TONE[position]) || UNKNOWN_POSITION_TONE;
  return (
    <span
      className={`w-8 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[0.65rem] font-bold ${tone.bg} ${tone.text} ${className}`}
    >
      {position ?? "–"}
    </span>
  );
}
