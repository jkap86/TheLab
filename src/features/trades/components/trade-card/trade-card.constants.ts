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
 * The give track is a groove milled into the card's face, dimmer and a step
 * smaller; the take track sits on that face itself. That is the whole of the
 * difference between them, and holding it here is what lets one set of
 * components draw both — the tone used to be re-derived as a `tone === "out"`
 * ternary in five places, which is five chances for the give track to end up a
 * step brighter than the take track it must never outrank.
 *
 * **Only the take track's value is engraved.** The give's sits in the groove,
 * where the cut's own lit lower lip is already a millimetre away, and a second
 * incision inside it reads as a smudge rather than as machining — the same
 * argument as the tones' brightness, applied to their finish.
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
    value: "lab-engraved-faint text-foreground/70",
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

/**
 * The value track, flush right on the same edge as the side's own total.
 *
 * On the display face, a size step down from the 11px it wore in the body face
 * — Orbitron is wider, so holding the size would push a four-digit price into
 * the name beside it. That is the rule the named list rows already follow, and
 * `tabular-nums` is what keeps a column of them lining up once the face changes
 * under them. Each tone decides its own colour and whether the numeral is cut
 * into what it sits on (see `ASSET_TONES`).
 */
export const ASSET_VALUE =
  "shrink-0 font-display text-[10px] font-medium tracking-[0.02em] tabular-nums";

/**
 * The sign's box: a hair over its own width, so names in both tracks start at
 * one x whichever mark precedes them.
 */
export const ASSET_BULLET = "mr-1 inline-block w-[0.7em] tabular-nums";

/**
 * One side's own box.
 *
 * **A region of the card's face, not a plate seated on it** — no fill, no wall,
 * no radius, nothing that makes it an object. That is the whole correction the
 * card was rebuilt for: a side used to wear `.lab-plate-sm` and the card's own
 * construction one step down, and one step is not enough to read as
 * containment, so a phone showed a column of manager plates rather than a list
 * of trades. Nothing inside the card is built like a card because nothing
 * inside it is built at all.
 *
 * The inset is the side's, not the face's: the face runs its regions edge to
 * edge so a seam between two of them can reach both walls, and each region
 * holds its own padding back off them.
 */
export const SIDE_ZONE = "min-w-0 px-3 py-2.5";

/**
 * The cut between two sides, in the two directions they can be adjacent in.
 *
 * A dark line with a lit far lip — the app's own milled seam, run **full
 * bleed**. Reaching both edges is what makes it machining in one part; the same
 * line inset from the edges is a border, and a border is what draws a box, and
 * a box is the plate this card just stopped drawing.
 *
 * Two spellings because the sides stack below `sm` and split above it, so a
 * seam that is horizontal on a phone is vertical on a laptop — the same
 * geometry the tracks flip on, one level out. Which side gets which is
 * arithmetic on the index rather than a flag: a side in the trailing column
 * (`i % 2 === 1`) is cut on its leading edge, and one that starts a row
 * (`i % 2 === 0`) is cut along its top. That is what puts a horizontal seam
 * above the odd side of a three-way, which spans both columns and so is under
 * both of them rather than beside either.
 *
 * Written as `inset` shadows on a box with no background, which paint fine —
 * and as whole literals, since a class Tailwind cannot read is a class it does
 * not emit.
 */
export const SIDE_SEAM_ROW =
  "shadow-[inset_0_1px_0_rgba(0,0,0,0.75),inset_0_2px_0_rgba(255,255,255,0.07)]";

export const SIDE_SEAM_COLUMN =
  "shadow-[inset_0_1px_0_rgba(0,0,0,0.75),inset_0_2px_0_rgba(255,255,255,0.07)] sm:shadow-[inset_1px_0_0_rgba(0,0,0,0.75),inset_2px_0_0_rgba(255,255,255,0.07)]";

/**
 * The same cut for a part whose regions are side by side at *every* width — the
 * search control, whose two bays never stack (a card's do, and the two spellings
 * above are what that costs).
 *
 * It is the `sm:` half of {@link SIDE_SEAM_COLUMN} with the breakpoint taken
 * off, and it lives here rather than in the control so the seam's own material —
 * the dark line and its lit far lip — has one definition for every part that
 * cuts one. Written out whole, because a class assembled from another is a class
 * Tailwind cannot read.
 */
export const SIDE_SEAM_VERTICAL =
  "shadow-[inset_1px_0_0_rgba(0,0,0,0.75),inset_2px_0_0_rgba(255,255,255,0.07)]";

/**
 * The card's first interior line, which the league specs now have to
 * themselves.
 *
 * **It used to hold the instant too, and that is why it was a reversed row.**
 * The timestamp was flush right, diagonally opposite the nameplate, with the
 * specs pushed left beside it — which meant the run was laid out in the ~180px
 * left over and took three lines on a phone while the space under the timestamp
 * sat empty, so the two had to stack below `sm`. The instant is on the top edge
 * now (see {@link TradeInstantLedge}), so all of that goes: one block, the
 * card's full width at every size, and no breakpoint.
 */
export const TRADE_HEADER_LINE = "px-3 pb-2";

/**
 * The bezel the specs sit in: one trough milled into the card's face.
 *
 * **The run is one part, and that is the whole change.** Six separate housings
 * read as perforation in the face rather than as one fact about the league, and
 * nothing in a run of six identical pills is easier to find than anything else.
 * Housed, it is a single object a reader learns the shape of once.
 *
 * `inline-flex` so the part is as wide as the league's own settings rather than
 * the card — a housing that reached both walls would have to be *filled*, and a
 * four-token redraft league would leave two thirds of it empty. It wraps, which
 * is what a phone gets: two rows inside one bezel rather than a run that
 * overflows, since the seam below is drawn by index and survives the wrap as the
 * housing's own inner edge.
 *
 * The material and its two depths are `.lab-bezel` in `globals.css`, per the
 * rule that a `.lab-*` class carries material and never layout.
 */
export const SPEC_BEZEL =
  "lab-bezel inline-flex max-w-full flex-wrap rounded-[5px] px-1 pb-1 pt-[3px]";

/**
 * One gauge's box: the caption over the value it names.
 *
 * A region of the bezel's floor rather than a part seated in it — no fill, no
 * wall, no radius. That is the card's own rule about sides applied one scale
 * down: giving each bay a face would be a third countable depth inside a part
 * that already has two, and nothing inside the housing is built like a part for
 * the same reason nothing inside the card is built like a card.
 */
export const SPEC_BAY =
  "flex min-w-0 flex-col gap-px px-[5px] pb-[3px] pt-0.5";

/**
 * The cut parting one gauge from the one before it — the card's own milled seam
 * ({@link SIDE_SEAM_VERTICAL}) at gauge scale, applied by index at the call
 * site because Tailwind has no adjacent-sibling selector and the first bay must
 * not wear one.
 *
 * Dimmer than the seam between two sides: this one is inside a recess, where
 * there is less light to catch, and a seam as strong as the card's own would
 * claim the gauges are as separate from each other as two managers' hauls are.
 */
export const SPEC_SEAM =
  "shadow-[inset_1px_0_0_rgba(0,0,0,0.65),inset_2px_0_0_rgba(255,255,255,0.05)]";

/**
 * The caption, cut into the bezel's floor.
 *
 * `.lab-engraved-faint` rather than the full-strength cut, which is the rule
 * that class exists for: the highlight is a fixed 1px whatever the type size, so
 * at 6px the strong lower lip is most of the stroke weight and reads as a blur.
 *
 * At 6px it is the smallest type in the app and it earns that by being a *unit*
 * rather than a word to read — `TEAMS` over `12 TEAM` is recognised at a glance
 * and never parsed, which is what lets it go this small. `whitespace-nowrap`
 * because a caption that wraps is taller than the value it names and the gauges
 * would stop lining up.
 */
export const SPEC_CAPTION =
  "lab-engraved-faint text-center font-display text-[6px] font-bold uppercase leading-[8px] tracking-[0.2em] text-foreground/35";

/**
 * The value, in a window sunk into the bezel's floor.
 *
 * On the display face at 9.5px — a hair under the 10px the asset values wear,
 * the rule a named row already follows, since Orbitron is wide and six of these
 * have to fit a phone. The glass and the lit lower lip are `.lab-gauge`.
 */
export const SPEC_GAUGE =
  "lab-gauge rounded-[3px] px-[7px] text-center font-display text-[9.5px] font-bold uppercase leading-[14px] tracking-[0.04em] tabular-nums whitespace-nowrap";

/**
 * How brightly a value is drawn, per {@link LeagueSpec.tone}.
 *
 * One step between them and no more. What game this is — the type, best ball —
 * changes what a trade means, so it reads first; the lineup and scoring detail
 * describes the room it happened in. Both stay well under the manager's name
 * below them, which is what the eye should reach next.
 *
 * **Both are the `foreground` token and neither is tinted.** A cyan-white
 * numeral was the obvious spelling and is the wrong one twice over: it has no
 * token to read, and the accent is already spent in every gauge's lower lip —
 * putting it in the type as well would light the numerals of a fact the card
 * ranks below both manager names.
 */
export const SPEC_TONE: Record<"format" | "config", string> = {
  format: "text-foreground/90",
  config: "text-foreground/65",
};

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
