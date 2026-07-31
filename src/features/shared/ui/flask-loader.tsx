import { useId } from "react";

/**
 * A loading indicator shaped like The Lab's flask, with liquid bubbling away
 * while something is in flight. Four looks, chosen with `variant`:
 *
 * - `bubble`   — steady glass, bubbles rise from the liquid and pop. The calm
 *                default; fits anywhere a spinner would.
 * - `fill`     — the liquid sloshes up and down as it bubbles. More motion,
 *                good for a full-page wait.
 * - `pulse`    — a neon-cyan brew under a glowing rim. On-brand and eye-catching.
 * - `reaction` — a vigorous boil with vapour escaping the neck. The busiest;
 *                reads as "hard at work".
 *
 * The glass is always the `active` cyan (the logo's, and the brand's). `tone`
 * colours the liquid — magenta like the logo, or cyan to match the accent —
 * and each variant picks the tone it was designed around unless overridden.
 *
 * Not a client component on purpose: it is pure SVG with no interactivity, so
 * it renders on the server too. `useId` (React 19) keeps every instance's
 * gradient/clip ids unique, so two loaders on one page can't collide.
 */

export type FlaskVariant = "bubble" | "fill" | "pulse" | "reaction";
export type FlaskTone = "magenta" | "cyan";

const TONES: Record<
  FlaskTone,
  { top: string; bottom: string; surface: string; bubble: string; steam: string }
> = {
  magenta: {
    top: "#ff4d84", bottom: "#c81d52", surface: "#ff5f92", bubble: "#ffd6e4",
    steam: "#ffe3ee",
  },
  cyan: {
    top: "#5cffef", bottom: "#00c2ad", surface: "#7dfff2", bubble: "#d4fffa",
    steam: "#bfeee9",
  },
};

const DEFAULT_TONE: Record<FlaskVariant, FlaskTone> = {
  bubble: "magenta",
  fill: "magenta",
  pulse: "cyan",
  reaction: "magenta",
};

/** The flask silhouette: rim, straight neck, flared cone, rounded base. */
const GLASS_PATH =
  "M46 23 L46 20 Q46 16 50 16 L70 16 Q74 16 74 20 L74 23 L68 23 L68 58 L94 124 " +
  "Q98 134 88 134 L32 134 Q22 134 26 124 L52 58 L52 23 Z";
/** The interior, inset from the glass, so liquid and bubbles stay in the cone. */
const INNER_PATH = "M55 40 L65 40 L90 123 Q93 130 86 130 L34 130 Q27 130 30 123 L55 40 Z";
/** A light streak down the neck and one wall — the glossy highlight. */
const SHINE_PATH = "M56 26 L56 57 L40 118";

type Bubble = { cx: number; cy: number; r: number; dur: number; delay: number };

const BUBBLES: Record<FlaskVariant, Bubble[]> = {
  bubble: [
    { cx: 52, cy: 120, r: 3.2, dur: 2.2, delay: 0 },
    { cx: 64, cy: 124, r: 2.4, dur: 2.6, delay: 0.6 },
    { cx: 58, cy: 118, r: 1.8, dur: 1.8, delay: 1.1 },
    { cx: 46, cy: 122, r: 2.0, dur: 2.4, delay: 1.6 },
  ],
  fill: [
    { cx: 54, cy: 120, r: 3.0, dur: 2.0, delay: 0 },
    { cx: 66, cy: 122, r: 2.2, dur: 2.4, delay: 0.8 },
    { cx: 48, cy: 124, r: 1.8, dur: 1.7, delay: 1.3 },
  ],
  pulse: [
    { cx: 52, cy: 120, r: 3.2, dur: 2.2, delay: 0 },
    { cx: 64, cy: 124, r: 2.4, dur: 2.6, delay: 0.6 },
    { cx: 58, cy: 118, r: 1.8, dur: 1.8, delay: 1.1 },
  ],
  reaction: [
    { cx: 50, cy: 120, r: 3.4, dur: 1.5, delay: 0 },
    { cx: 60, cy: 122, r: 2.8, dur: 1.7, delay: 0.3 },
    { cx: 68, cy: 118, r: 2.2, dur: 1.3, delay: 0.6 },
    { cx: 44, cy: 121, r: 2.0, dur: 1.6, delay: 0.9 },
    { cx: 56, cy: 119, r: 1.6, dur: 1.2, delay: 1.2 },
  ],
};

/** Vapour puffs above the neck — the `reaction` variant only. */
const STEAM: Bubble[] = [
  { cx: 57, cy: 18, r: 3.0, dur: 2.4, delay: 0 },
  { cx: 63, cy: 16, r: 2.4, dur: 2.8, delay: 0.9 },
];

export function FlaskLoader({
  variant = "bubble",
  size = 96,
  tone,
  label = "Loading",
  className = "",
}: {
  variant?: FlaskVariant;
  /** Width in px; height follows the flask's aspect ratio. */
  size?: number;
  tone?: FlaskTone;
  /** Accessible name for the `role="status"` element; never rendered visibly. */
  label?: string;
  className?: string;
}) {
  const id = useId();
  const glass = `glass-${id}`;
  const liquid = `liquid-${id}`;
  const clip = `clip-${id}`;
  const glow = `glow-${id}`;

  const colors = TONES[tone ?? DEFAULT_TONE[variant]];
  const surfaceY = variant === "pulse" ? 100 : variant === "reaction" ? 99 : 98;

  const bubbles = BUBBLES[variant].map((b, i) => (
    <circle
      key={i}
      className="flask-bub"
      cx={b.cx}
      cy={b.cy}
      r={b.r}
      fill={colors.bubble}
      style={{ animation: `flask-rise ${b.dur}s ease-in ${b.delay}s infinite` }}
    />
  ));

  const liquidBody = (
    <>
      <rect x="20" y={surfaceY} width="80" height="46" fill={`url(#${liquid})`} />
      <ellipse cx="60" cy={surfaceY} rx="30" ry="4" fill={colors.surface} />
    </>
  );

  return (
    <span
      className={`flask-loader inline-flex ${className}`}
      role="status"
      aria-label={label}
    >
      <svg
        width={size}
        height={size * 1.25}
        viewBox="0 0 120 150"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={glass} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-active)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--color-active)" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id={liquid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colors.top} />
            <stop offset="1" stopColor={colors.bottom} />
          </linearGradient>
          <clipPath id={clip}>
            <path d={INNER_PATH} />
          </clipPath>
          {variant === "pulse" && (
            <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* pulse: a blurred, glowing copy of the outline breathing behind the glass */}
        {variant === "pulse" && (
          <path
            d={GLASS_PATH}
            stroke="var(--color-active)"
            strokeWidth="3"
            strokeLinejoin="round"
            filter={`url(#${glow})`}
            style={{ animation: "flask-glow 1.8s ease-in-out infinite" }}
          />
        )}

        {/* reaction: vapour escaping the neck, drawn before the glass so the rim overlaps it */}
        {variant === "reaction" &&
          STEAM.map((s, i) => (
            <circle
              key={i}
              className="flask-bub"
              cx={s.cx}
              cy={s.cy}
              r={s.r}
              fill={colors.steam}
              style={{ animation: `flask-steam ${s.dur}s ease-out ${s.delay}s infinite` }}
            />
          ))}

        <g clipPath={`url(#${clip})`}>
          {variant === "fill" ? (
            <g style={{ animation: "flask-fill 2.8s ease-in-out infinite" }}>{liquidBody}</g>
          ) : (
            liquidBody
          )}
          {bubbles}
        </g>

        <path
          d={GLASS_PATH}
          fill={`url(#${glass})`}
          stroke="var(--color-active)"
          strokeOpacity="0.55"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d={SHINE_PATH}
          stroke="var(--color-foreground)"
          strokeOpacity="0.22"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
