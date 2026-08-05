import type { AssetTone } from "./trade-card.types.ts";

/**
 * The card's class strings, written out whole so Tailwind can see them.
 *
 * A class Tailwind cannot read as a literal is a class it does not emit, so
 * nothing here may be assembled at render time — the same rule the ADP board's
 * grids are constants for. What is built at a call site is only the join of two
 * literals, which leaves both halves readable in this file.
 */

/** What one line of a haul is made of, per {@link AssetTone}. */
export type AssetToneStyle = {
  /**
   * The line's leading mark — a real `+` or `−` rather than a bullet, so it
   * says which way the line moved. It is the only direction mark on the card.
   */
  sign: string;
  /** The track itself: a groove milled into the plate, or the plate's own face. */
  track: string;
  /** The line's own type size. */
  row: string;
  /** What the asset is called. */
  name: string;
  /** The trailing detail on that name — a position and team, a pick's origin. */
  meta: string;
  /** The sign's own colour; see {@link sign}. */
  bullet: string;
  /** The metric's reading of this line. */
  value: string;
  /** That reading when the metric covers the line and has no number for it. */
  dash: string;
  /**
   * Whether a player line carries his position and team.
   *
   * **A give line names the player and nothing else.** Those eight characters
   * are already printed against him on the side that took him — the give track
   * exists only on a two-sided trade, so that listing is always there — and in a
   * track this narrow they were the difference between one line and two. What a
   * *pick's* origin says is not available anywhere else on the card, so that
   * detail stays on both tracks and is not gated here.
   */
  playerDetail: boolean;
};

/**
 * The two tracks' material, in one table.
 *
 * The give track is a groove milled into the side plate, dimmer and a step
 * smaller; the take track sits on the plate's own lit face. That is the whole of
 * the difference between them, and holding it here is what lets one set of
 * components draw both — the tone used to be re-derived as a `tone === "out"`
 * ternary in five places, which is five chances for the give track to end up a
 * step brighter than the take track it must never outrank.
 *
 * **The two are deliberately not equally lit.** The take is the thing being
 * read, so its sign carries the accent, where the give's is the dimmest mark in
 * the block — that ordering is what keeps a card reading take-first even though
 * it prints both halves.
 */
export const ASSET_TONES: Record<AssetTone, AssetToneStyle> = {
  in: {
    sign: "+",
    track: "flex min-w-0 flex-col gap-y-1.5",
    row: "text-[13px]",
    name: "text-foreground/85",
    meta: "text-foreground/45",
    bullet: "text-active/50",
    value: "text-foreground/60",
    dash: "text-foreground/25",
    playerDetail: true,
  },
  out: {
    sign: "−",
    track: "lab-groove flex min-w-0 flex-col gap-y-1 rounded-md px-1.5 py-1.5",
    row: "text-xs",
    name: "text-foreground/50 [text-shadow:0_1px_1px_rgba(0,0,0,0.9)]",
    meta: "text-foreground/25",
    bullet: "text-foreground/25",
    value: "text-foreground/30",
    dash: "text-foreground/20",
    playerDetail: false,
  },
};

/**
 * One line of a haul: what it is on the left, what the chosen metric makes of it
 * on the right.
 *
 * A two-track grid rather than a flex row, so every value in a track lands on
 * the same x whatever the names beside them do — the structure a column of
 * numbers is worth having at all. The name track is `minmax(0,1fr)` so a long
 * name wraps inside it rather than pushing the value off the card: assets wrap
 * rather than truncate here, because a truncated "Christian McCa…" is a card
 * that has to be opened somewhere else to read.
 */
export const ASSET_ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 leading-snug";

/** The name track, which is the half allowed to wrap. */
export const ASSET_NAME = "min-w-0 break-words";

/** The value track, flush right on the same edge as the side's own total. */
export const ASSET_VALUE = "shrink-0 text-[11px] font-medium tabular-nums";

/**
 * The sign's box: a hair over its own width, so names in both tracks start at
 * one x whichever mark precedes them.
 */
export const ASSET_BULLET = "mr-1 inline-block w-[0.7em] tabular-nums";

/**
 * Two tracks side by side from `sm` up and stacked below it, which is the same
 * thing that happens to the sides themselves one level out — and for the same
 * reason. What breaks down at 390px is geometry, not the idea: a track is ~120px
 * there, and a column that narrow turns every name into two lines. The give
 * track takes the smaller share of the pair, because its lines carry no position
 * and team.
 */
export const ASSET_TRACKS_PAIRED =
  "sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]";
