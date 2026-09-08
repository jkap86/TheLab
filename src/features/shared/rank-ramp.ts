/**
 * A place in a field: how full its meter is, what percentile colours it, where
 * a figure places among others, and the ramp that turns any of them into a
 * colour.
 *
 * The ramp lived in `features/manager/helpers/lineup-metrics.ts` until the
 * lineup checker's projected-outcome pip needed the same green and the same
 * red — the line that moves a client piece into `features/shared`, the one
 * `CONSOLE_KEY` and `ManagerPlate` moved on. A second red drawn beside this one
 * would be two greens for "good" on two pages showing the same leagues, and
 * only one of them would invert correctly for light mode.
 *
 * The three readings below followed it when `LeagueTeams` did, for the reason a
 * module in this folder cannot import one from `features/manager`: the
 * standings pane draws its own meters and colours its own totals, and it is a
 * sibling feature's to read now rather than the manager page's alone. They stay
 * in one module with the ramp because {@link rankFill} and {@link rankColor}
 * must be fed the same number — split across two files is how the bar and the
 * hue would come to disagree.
 *
 * `lineup-metrics.ts` re-exports all four, so its own readers and its test did
 * not move with them — which is also why the file keeps its name.
 */

import type { MetricRank } from "@/shared/contract";

/**
 * How full a tile's meter is: 100% for 1st, 0% for last.
 *
 * **`of - 1` is the divisor, not `of`.** A meter that ran `rank / of` would
 * leave 1st of 12 sitting at 92% and last of 12 at 8%, so neither end of the
 * scale would ever be reached and the bar would read as a broken gauge rather
 * than as a position. A one-roster league (`of === 1`) has no spread to show
 * and draws empty, as does a null rank.
 */
export function rankFill(rank: MetricRank | null): number {
  if (!rank || rank.of <= 1) return 0;
  return Math.round((1 - (rank.rank - 1) / (rank.of - 1)) * 100);
}

/**
 * The percentile a rank's *colour* is taken from, or null where there is no
 * position to colour.
 *
 * It exists because {@link rankFill} answers 0 to two different questions.
 * Last of twelve is 0 and so is "nothing to rank" — a null rank, or a
 * one-roster league with no spread — and the meter is right to draw both
 * empty. The ramp is not: painting an absent answer in full red claims a
 * result the page has not been given. So the degenerate cases come back as
 * null here and land on the neutral, and only a real last place is red.
 */
export function rankPercentile(rank: MetricRank | null): number | null {
  if (!rank || rank.of <= 1) return null;
  return rankFill(rank);
}

/**
 * A rank, as a colour on a red -> neutral -> green ramp.
 *
 * **A rank's colour is its percentile, not its ordinal**: 1st of 12 and 1st of
 * 8 are different achievements, and the figure beside it already says which.
 * The number fed in is therefore the same one the meter's width is taken from
 * ({@link rankFill}), so the bar and the hue can never disagree.
 *
 * Chroma rides distance from mid-pack rather than the rank itself, which is
 * what keeps the scale honest: a middling rank lands on the theme's neutral
 * and only a real result earns any colour at all. The hue only picks the side.
 *
 * The lightness and chroma bounds are tokens because the same ramp runs on two
 * very different glasses — near-white on the dark readout, dark grey on the
 * light one — and only the endpoints differ. That is also why this returns a
 * computed string rather than a Tailwind class: the value is continuous, so it
 * goes through `style`, and there is no utility to generate.
 *
 * This replaced the metric-*family* colouring (`metricToneClass` /
 * `metricFillClass`, accent for points and `--metric-secondary` for capital).
 * A tile has one colour to spend and it now spends it on the rank; the unit is
 * read off the label above the figure.
 *
 * @param fill 0–100 from {@link rankPercentile}, or null for mid-pack neutral.
 * @param alpha Optional opacity, for the meter's glow.
 */
export function rankColor(fill: number | null, alpha?: number): string {
  const p = fill === null ? 0.5 : Math.max(0, Math.min(1, fill / 100));
  // 0 at the median, 1 at either end.
  const t = Math.abs(p - 0.5) * 2;
  const hue = p < 0.5 ? 25 : 150;
  const l = `calc(var(--rank-l-mid) + (var(--rank-l) - var(--rank-l-mid)) * ${t})`;
  const c = `calc(var(--rank-c) * ${t})`;
  return `oklch(${l} ${c} ${hue}${alpha === undefined ? "" : ` / ${alpha}`})`;
}

/**
 * The polished face for a ramp percentile: a white lip, the tone at the optical
 * middle, receding to a shaded foot — the ramp's own hue set as **tinted
 * chrome**.
 *
 * It is `--chrome-face` / `--billet-face`'s shape and `--alert-face`'s
 * technique, tinted rather than neutral so the *reading* survives the polish: a
 * neutral chrome figure on a machined strip says nothing about whether the week
 * went well, which is the whole job of a figure the ramp colours.
 *
 * **Computed rather than a token, because the hue is continuous**, which is
 * {@link rankColor}'s own argument one step down — there is no utility to
 * generate and no finite set of values to name. What *is* a token is the shape:
 * the five stops' lightness deltas and chroma multipliers, because those are
 * what turn over for the light scheme. In dark the relief is bought by spiking
 * the top stop to white above a base that is already near-white; on the pale
 * billet a white lip is invisible, so the light face is the same direction with
 * a much shallower travel over a base that is already dark — which is exactly
 * what `--alert-face` does between the two schemes, and why the deltas differ
 * rather than the formula.
 *
 * Applied with `background-clip: text` over a transparent fill; see
 * {@link rampDepth} for the half that must be a `filter`.
 */
export function rampFace(percentile: number | null): string {
  const stops = RAMP_STOPS.map(
    ({ at, l, c }) => `${rampStop(percentile, l, c)} ${at}%`,
  );
  return `linear-gradient(180deg, ${stops.join(", ")})`;
}

/**
 * The polished face's cast. **It must be used as `filter`, never as
 * `text-shadow`.**
 *
 * With `background-clip: text` over a transparent fill the element's background
 * paints first, so a `text-shadow` paints *above* it — the dark offset copies
 * cover the gradient inside the glyph bodies and the figure renders as flat ink
 * with a 1px lit rim. Chained `drop-shadow`s composite behind the clipped
 * gradient. `globals.css` records the same failure against `--alert-depth` and
 * `card-plate.tsx` against `--wordmark-depth`.
 *
 * The static half is `--ramp-depth`, a token because it inverts wholesale for
 * light mode rather than dimming — the lit hairline under the glyph becomes a
 * dark one and the dark step becomes a light one, which is what
 * `--figure-engrave` and `--standing-engrave` already do between the schemes.
 * Only the halo is computed, and a `filter` is a space-separated list, so the
 * two compose in one declaration exactly as a `text-shadow` and its glow do.
 *
 * **A caller gates it on `pointer-fine:`**, on the league card's per-device
 * budget: a `filter` is a compositor buffer per element and this is up to three
 * per card on a page with no virtualizer, which is the same budget that killed
 * an iOS Safari tab. A coarse pointer gets the tinted ramp clipped to the
 * glyphs, without the cast. The value therefore travels through a custom
 * property that a `pointer-fine:[filter:…]` utility reads — a `style` cannot
 * carry a variant.
 */
export function rampDepth(percentile: number | null): string {
  return `var(--ramp-depth) drop-shadow(0 0 14px ${rankColor(percentile, 0.45)})`;
}

/**
 * The five stops, as offsets down the glyph and as *names* of the per-scheme
 * numbers that shape them.
 *
 * The 52% stop is the ramp colour itself and takes no tokens: it is what the
 * figure would be with no polish at all, which is what keeps the polished
 * reading and `rankColor`'s own the same colour.
 */
const RAMP_STOPS: readonly { at: number; l?: string; c?: string }[] = [
  { at: 0, l: "--ramp-face-l0", c: "--ramp-face-c0" },
  { at: 22, l: "--ramp-face-l1", c: "--ramp-face-c1" },
  { at: 52 },
  { at: 78, l: "--ramp-face-l3", c: "--ramp-face-c3" },
  { at: 100, l: "--ramp-face-l4", c: "--ramp-face-c4" },
];

/**
 * One stop of the face, as an `oklch()` the browser resolves.
 *
 * The lightness is clamped rather than added raw, because the deltas run past
 * both ends: dark mode's lip is `+0.6` on a base of up to 0.99 precisely so it
 * lands on white whatever the percentile did, and `--ramp-face-floor` is where
 * a foot stops descending — the legibility bound the token's own note carries
 * the measurement for. `clamp()` is a math function and resolves wherever a
 * `<number>` is allowed.
 */
function rampStop(
  percentile: number | null,
  l: string | undefined,
  c: string | undefined,
): string {
  const p = percentile === null ? 0.5 : Math.max(0, Math.min(1, percentile / 100));
  const t = Math.abs(p - 0.5) * 2;
  const hue = p < 0.5 ? 25 : 150;
  const base = `(var(--rank-l-mid) + (var(--rank-l) - var(--rank-l-mid)) * ${t})`;
  const chroma = `(var(--rank-c) * ${t})`;
  if (!l || !c) return `oklch(calc${base} calc${chroma} ${hue})`;
  return (
    `oklch(clamp(var(--ramp-face-floor), ${base} + var(${l}), 1) ` +
    `calc(${chroma} * var(${c})) ${hue})`
  );
}

/**
 * Where one figure sits among the league's, as a rank the meters and the ramp
 * above can read.
 *
 * The server ranks the nine metrics a card's tiles show; this is the same
 * reading taken client-side for a figure it does not rank — today the bench
 * total under whichever lens the expanded card is on, which changes with a
 * control rather than with the payload. It is **standard competition ranking**,
 * the same rule `MetricRank` documents: tied figures share the better rank and
 * the next distinct one skips.
 *
 * Null where there is nothing to rank, which is two cases and not one: a field
 * of fewer than two, and a field where every figure is zero — a league with no
 * projections read, or one whose KeepTradeCut board could not be. "1st of 12"
 * among all-zero totals is a claim, which is exactly why `LineupRanks` ships
 * null for it rather than a rank.
 */
export function placeAmong(
  value: number,
  all: readonly number[],
): MetricRank | null {
  if (all.length <= 1 || all.every((figure) => figure === 0)) return null;
  return { rank: all.filter((figure) => figure > value).length + 1, of: all.length };
}

/**
 * How much of the league's points one team holds, as a percentile the ramp can
 * read.
 *
 * **A rank is the wrong input for a table of totals**, which is the whole of
 * why this exists beside {@link rankPercentile}. A rank ramp spends its full
 * red and its full green in *every* league, because somebody is always first
 * and somebody is always last — so twelve teams sitting within a point of each
 * other read as a blowout, and the colour says nothing the ordinal beside it
 * had not already said. Anchored on the league's own mean instead, a tight
 * table lands every row on the neutral and only a real spread reaches the ends.
 *
 * The saturation is ±10% of the mean, which is a claim about fantasy scoring
 * rather than a round number: a team 10% clear of its league's average points
 * is comfortably the best in it, and one 10% adrift is out of the race. Beyond
 * that the ramp has nothing further to say and clamps.
 *
 * Null in for a mean of zero — a league whose totals are all zero has no share
 * to take, which is {@link rankPercentile}'s own "nothing to colour" rule at
 * this grain and the reason a caller must still gate on the all-zero case.
 */
const SHARE_SATURATE = 0.1;

export function sharePercentile(
  total: number,
  all: readonly number[],
): number {
  if (all.length === 0) return 50;
  const mean = all.reduce((sum, v) => sum + v, 0) / all.length;
  if (mean === 0) return 50;
  return clampPercent(50 + ((total - mean) / mean / SHARE_SATURATE) * 50);
}

/**
 * One seat's figure against the league's median at that same slot.
 *
 * **The comparison is positional, which is what makes the colour worth
 * printing.** A seat drawn on its own magnitude would paint every quarterback
 * green and every kicker red, since the two are not on one scale; read against
 * the twelve rosters' middle player at that seat, a green QB1 is one that
 * actually beats the league's, and a red one is a hole to fix.
 *
 * ±20% rather than the standings' ±10%, and the widening is measured rather
 * than chosen: one slot spreads much further across a league than a whole
 * roster does — the best QB in a twelve-team league routinely doubles the
 * worst, where the best *roster* rarely clears the worst by half.
 *
 * A median of zero is a slot no roster in the league has a figure for — the
 * lens is silent on it, or the board could not be read — so it comes back
 * neutral rather than painting an absent answer.
 */
const SLOT_SATURATE = 0.2;

export function slotPercentile(value: number, median: number): number {
  if (!median) return 50;
  return clampPercent(50 + ((value - median) / median / SLOT_SATURATE) * 50);
}

/** Both scales saturate rather than run off the ramp's ends. */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * A record, as a percentile — its win share stretched across .250–.750.
 *
 * **The raw share is the wrong number to hand the ramp**, and the reason is
 * where records actually land: almost every one in a played season sits between
 * a quarter and three quarters, so 8–5 (.615) and 7–6 (.538) would both come
 * back a hair off the neutral and the colour would say nothing. Stretched over
 * the band records occupy, the same two are 73 and 58 — visibly different, which
 * is the whole job.
 *
 * Ties are not counted on either side. A tie is neither result, and a league
 * that has them is a league where the two ends of this scale mean what they
 * always did.
 *
 * Neutral for a record of no games: a manager who has not played is not a
 * manager who has lost.
 */
export function winSharePercentile(wins: number, losses: number): number {
  const played = wins + losses;
  if (played === 0) return 50;
  return clampPercent(((wins / played - 0.25) / 0.5) * 100);
}

/**
 * The median of a set of figures, or 0 where there is nothing to take one of.
 *
 * The plain even-length average of the two middle values, which is what
 * {@link slotPercentile} wants: a *typical* figure at this seat, not a rank in
 * it. Zero is the "nothing to compare against" answer the percentile above
 * reads as neutral — the same absence, spelled once.
 */
export function median(all: readonly number[]): number {
  if (all.length === 0) return 0;
  const sorted = [...all].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}
