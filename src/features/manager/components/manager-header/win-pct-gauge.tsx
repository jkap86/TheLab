import { useId } from "react";

import { formatWinPct } from "../../format";

/**
 * The win percentage as a dial.
 *
 * The number is the one figure on the plate that is a verdict rather than a
 * count, so it is drawn against the field it lives in — half the ring is a .500
 * season — where a bare `.537` reads as another statistic. It shares its slot
 * with the kickoff countdown ({@link HeaderReadout}), which is also why it keeps
 * its em-dash face rather than being dropped before a season starts: it is what
 * the plate shows while the kickoff instant is still resolving. Pure SVG, so it
 * renders on the server and stays out of the bundle; `useId` keeps the gradient
 * id unique in case two ever share a page.
 */
export function WinPctGauge({ pct }: { pct: number | null }) {
  const gradientId = useId();
  // r=44 in a 100-unit box: circumference to the third decimal, so the arc lands
  // where the label says it does.
  const circumference = 2 * Math.PI * 44;

  return (
    <div className="relative grid h-[56px] w-[56px] flex-none place-items-center sm:h-[66px] sm:w-[66px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-active)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-active)" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth="7"
          className="stroke-foreground/[0.07]"
        />
        {pct !== null && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            className="drop-shadow-[0_0_6px_rgba(0,255,229,0.45)]"
          />
        )}
      </svg>
      <div className="flex flex-col items-center gap-0.5">
        <span
          className={`font-mono text-[15px] font-semibold leading-none tabular-nums tracking-tight sm:text-lg ${
            pct === null ? "text-foreground/35" : ""
          }`}
        >
          {formatWinPct(pct)}
        </span>
        <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-foreground/40 sm:text-[9px]">
          Win pct
        </span>
      </div>
    </div>
  );
}
