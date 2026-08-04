const POSITION_TONE: Record<string, string> = {
  QB: "bg-rose-500/15 text-rose-300",
  RB: "bg-emerald-500/15 text-emerald-300",
  WR: "bg-sky-500/15 text-sky-300",
  TE: "bg-amber-500/15 text-amber-300",
  K: "bg-violet-500/15 text-violet-300",
  DEF: "bg-teal-500/15 text-teal-300",
};

/** A position pill, colour-coded by position. */
export function PositionBadge({
  position,
  className = "inline-flex",
}: {
  position: string | null;
  className?: string;
}) {
  const tone =
    (position && POSITION_TONE[position]) || "bg-foreground/5 text-foreground/40";
  return (
    <span
      className={`w-8 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[0.65rem] font-bold ${tone} ${className}`}
    >
      {position ?? "–"}
    </span>
  );
}
