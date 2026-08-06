/**
 * A KeepTradeCut value with locale grouping and no decimals, e.g. `"41,320"`.
 *
 * The opposite convention to {@link formatPoints}, and deliberately: KTC's
 * numbers are whole and four digits wide, so a decimal place would be two
 * characters of noise on a chip already carrying three totals.
 */
export function formatValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * A player's name with the first name contracted to an initial, for the roster
 * panel's narrow tier: `"Christian McCaffrey"` → `"C. McCaffrey"`.
 *
 * The panel is a 50/50 split at every width, so on a phone a roster row's name
 * track is ~126px — and at 14px that is roughly where real player names *start*.
 * Measured over the pool: `Michael Pittman Jr.` is 118px, `Christian McCaffrey`
 * 123, `Chigoziem Okonkwo` 128, `JuJu Smith-Schuster` 129, and an IDP league's
 * `Jeremiah Owusu-Koramoah` is 174. Truncation there is not recoverable either —
 * `title` is a hover affordance and there is no hover on a phone — so what is cut
 * has simply left the panel.
 *
 * **Unconditional rather than past a length threshold, which is the part worth
 * not "fixing" back.** A character count is a poor proxy for a width: the two
 * names above at 17 and 19 characters are 128px and 118px respectively, so no
 * threshold separates the names that fit from the ones that don't — every
 * setting either contracts names that had room or clips names that didn't. It is
 * also what keeps the column uniform, which is how a box score has written this
 * for a century; the full name is back at `@lg`, where the track can hold it.
 *
 * Two things it must not do. A team defence is not a person — `Pittsburgh
 * Steelers` is the team's name, and `P. Steelers` is nothing — so `DEF` is
 * returned whole. And a name with no space (an unresolved player id, the `Empty`
 * placeholder) has no first name to contract, so it is returned as it came.
 *
 * It does not promise the result fits: `J. Owusu-Koramoah` is 128px against that
 * ~126px track and still loses a character. It takes that row from losing a third
 * of the name to losing the last letter of it, which is the whole of the claim.
 */
export function shortPlayerName(name: string, position: string | null): string {
  if (position === "DEF") return name;
  const space = name.indexOf(" ");
  if (space < 1) return name;
  return `${name[0]}. ${name.slice(space + 1)}`;
}

// `ordinal` moved to `features/shared/format.ts` when the trades page needed the
// same words for a pick's round; the record and countdown formatters followed it
// there when the lineup checker started wearing the manager plate, which is what
// writes all four. Re-exported here so this module's own consumers keep reading
// them from where they always have.
export { ordinal } from "../shared/format.ts";
export {
  countdownSegments,
  formatCountdown,
  formatPoints,
  formatRecord,
  formatWinPct,
} from "../shared/format.ts";
export type { CountdownSegment } from "../shared/format.ts";

/** `3 weeks`, or `1 week` — for tooltips, where the count is spelled out. */
export function weekCount(n: number): string {
  return `${n} week${n === 1 ? "" : "s"}`;
}

/**
 * The week horizon a projection covers, e.g. `"Wk 3–5"`, `"Wk 3"`, `"Wk 3, 5"`.
 *
 * Worth the few lines because the horizon is not what a reader assumes: the sync
 * keeps a short window of weeks warm, so a "rest of season" total is usually two
 * weeks deep. Every projected number is shown next to this rather than left to
 * imply a full season.
 *
 * Runs of consecutive weeks collapse to a range; gaps (an unsynced week between
 * two synced ones) stay visible as separate entries, since that is a hole in the
 * total rather than a shorter horizon.
 */
export function formatWeekRange(weeks: readonly number[]): string {
  if (weeks.length === 0) return "no weeks";

  const sorted = [...weeks].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const week of sorted) {
    const run = runs.at(-1);
    if (run && week === run[1] + 1) run[1] = week;
    else runs.push([week, week]);
  }

  return `Wk ${runs
    .map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`))
    .join(", ")}`;
}
