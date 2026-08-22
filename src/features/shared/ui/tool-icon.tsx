import type { ToolIconName } from "../tools";

/**
 * The glyph a tool wears in the app bar's menu — one 20px line drawing per
 * tool, keyed by the `icon` name in the catalogue.
 *
 * The paths live here rather than in `tools.ts` so that module stays free of
 * JSX and testable under Node's runner, and so the whole set can be restyled
 * (weight, cap, size) in one place. Everything strokes `currentColor`, so an
 * item's hover and active colour reach the icon without a second rule.
 *
 * The tool *cards* deliberately have no icon — the name carries the card there.
 * A menu row is a different problem: it is scanned, not read.
 */
const PATHS: Record<ToolIconName, React.ReactNode> = {
  // Stacked plates — a pile of leagues.
  leagues: (
    <>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="m3 12 9 4.5L21 12" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </>
  ),
  // A single figure: the players you hold.
  players: (
    <>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  // Two figures: the people you play against.
  leaguemates: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8" />
      <path d="M17.5 14.2A6 6 0 0 1 21 19.5" />
    </>
  ),
  // Crosshair — following a draft board pick by pick.
  picktracker: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  // Two arrows passing: assets going both ways.
  trades: (
    <>
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </>
  ),
  // A checked list — the lineup validated.
  lineup: (
    <>
      <path d="M3.5 7.5 5 9l2.5-3" />
      <path d="M3.5 16.5 5 18l2.5-3" />
      <path d="M11 7.5h9.5M11 16.5h9.5" />
    </>
  ),
  // Two overlapping profiles side by side — one player measured against another.
  comps: (
    <>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </>
  ),
};

/**
 * The two boxes this set is drawn in, and the stroke each one needs.
 *
 * **The weight is not a constant, because a stroke on a 24 viewBox is not a
 * width on screen.** These paths are laid out at 24 and scaled by the box, so
 * 1.6 renders at 1.33px in the menu and at 0.93px on a 14px key — a hairline
 * against the 1.28px the rail's own 16-viewBox glyphs carry beside it. The
 * small size takes 2, which lands at 1.17px and reads as the same pen.
 *
 * **It is a table rather than a `className` prop**, for the rule a shared part
 * hard-coding a box has already broken once here: Tailwind emits `.h-5` and
 * `.h-3\.5` at equal specificity and sorts them alphabetically, so a caller's
 * override would win or lose on the generated order and nothing in the class
 * list or the compiler would say which. A closed set of named sizes cannot be
 * half-overridden.
 */
const SIZES = {
  /** The app bar's menu — a row that is scanned. */
  menu: { box: "h-5 w-5", stroke: 1.6 },
  /** Sunk in a key's milled seat — the manager view switch. */
  key: { box: "h-3.5 w-3.5", stroke: 2 },
} as const;

export type ToolIconSize = keyof typeof SIZES;

export function ToolIcon({
  name,
  size = "menu",
}: {
  name: ToolIconName;
  size?: ToolIconSize;
}) {
  const { box, stroke } = SIZES[size];
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={box}
    >
      {PATHS[name]}
    </svg>
  );
}
