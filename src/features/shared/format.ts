/**
 * Formatting shared by more than one tool. What lands here is what a second tool
 * needed — the trades page names a pick's round the same way the roster panel
 * does, and a round spelled two ways in one app is the drift this file exists to
 * stop.
 *
 * `features/manager/format.ts` re-exports what moves here so its own consumers
 * keep their import. It is now a shim and nothing else: the last four functions
 * it still owned went with the league detail panel, which the trades page draws
 * over its own cards.
 */

/**
 * A number as an ordinal, e.g. `1` → `"1st"`, `2` → `"2nd"`, `13` → `"13th"`.
 *
 * How draft picks are spoken about — "a 2026 1st", "their 3rd" — so it labels a
 * pick's round that way rather than as a bare number.
 */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * The five below came here with the manager plate, when the lineup checker
 * started wearing the same card for a *projected* week's record — four of them
 * are what that plate is written in, and `formatPoints` is what its list's own
 * bench-gap column prints. The plate itself is `ui/manager-header`.
 */

/**
 * Fantasy points to two decimals with locale grouping, e.g. `"1,234.56"`.
 * Always two, because a column of points that changes width row to row is
 * hard to scan.
 */
export function formatPoints(points: number): string {
  return points.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Record_ = { wins: number; losses: number; ties: number };

/**
 * A win-loss record, e.g. `"9-4"` or `"9-4-1"`.
 *
 * Ties are omitted when there are none, since most leagues never tie and a
 * trailing `-0` is noise.
 */
export function formatRecord(record: Record_): string {
  const { wins, losses, ties } = record;
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

/**
 * A win percentage the way a standings page writes one: `.537`, `1.000`, and an
 * em dash where nothing has been played.
 *
 * Three decimals with the leading zero dropped is the convention every sport
 * uses for this number, and it keeps the string four characters wide so it
 * doesn't reflow the gauge it sits inside. Null is the {@link aggregateRecord}
 * no-games case, not a formatting failure — see the rule there.
 */
export function formatWinPct(pct: number | null): string {
  if (pct === null) return "—";
  return pct.toFixed(3).replace(/^0\./, ".");
}

/**
 * Time remaining as a countdown, e.g. `"37d 04h 12m 45s"`, `"4h 09m 00s"`,
 * `"12m 03s"`, `"41s"`.
 *
 * Units the countdown has outgrown drop off the left as they empty — weeks out
 * it reads in days, on game day in hours — while everything after the leading
 * unit is zero-padded so the string ticks in place rather than reflowing.
 * Never negative: an instant already passed clamps to `"0s"`, though callers
 * generally hide the timer before that.
 */
export function formatCountdown(msLeft: number): string {
  return countdownSegments(msLeft)
    .map((segment) => `${segment.value}${segment.short}`)
    .join(" ");
}

/** One unit of a countdown, as its own readout cell. */
export type CountdownSegment = {
  /** The digits, zero-padded except in the leading cell. */
  value: string;
  /** The unit under the digits, e.g. `"days"`. */
  unit: string;
  /** The same unit as the single letter {@link formatCountdown} writes. */
  short: string;
};

/**
 * The same countdown split into its units, for a readout that gives each one a
 * cell of its own rather than a run of text.
 *
 * It is the primitive and {@link formatCountdown} is the join of it, so the
 * segmented display and the string a screen reader is handed can't disagree
 * about how long is left — the two are one calculation. The dropping and the
 * padding are that function's rules verbatim: units the countdown has outgrown
 * fall off the left as they empty, and everything after the leading unit is
 * padded so the cells tick in place rather than reflowing.
 */
export function countdownSegments(msLeft: number): CountdownSegment[] {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const all = [
    { value: Math.floor(total / 86_400), unit: "days", short: "d" },
    { value: Math.floor((total % 86_400) / 3_600), unit: "hrs", short: "h" },
    { value: Math.floor((total % 3_600) / 60), unit: "min", short: "m" },
    { value: total % 60, unit: "sec", short: "s" },
  ];

  // Everything from the first non-zero unit onward; seconds alone when the whole
  // countdown is under a minute.
  const lead = all.findIndex((segment) => segment.value > 0);
  const shown = all.slice(lead === -1 ? all.length - 1 : lead);

  return shown.map((segment, index) => ({
    ...segment,
    value: index === 0 ? String(segment.value) : String(segment.value).padStart(2, "0"),
  }));
}

/**
 * The four below came here with the league detail panel, when the trades page
 * started opening a card into the same standings and rosters — they are what
 * that panel and the metric catalogues behind it are written in. The panel
 * itself is `ui/league-detail`.
 */

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
