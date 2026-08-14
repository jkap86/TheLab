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

import { MONTH_ABBREVIATIONS } from "./date-range.ts";

/**
 * A moment's date, e.g. `Jul 15, 2026`. Spelled out through the shared month
 * table rather than `toLocaleDateString` so it reads the same wherever the page
 * is opened — the same rule the ADP range labels follow. An instant nothing is
 * known about (a trade Sleeper filed without a timestamp) says so rather than
 * showing an epoch.
 *
 * **It came here from the trade card with the timeline rail**, which names its
 * stops the same way — a rail drawn on the leagues list could not reach a
 * formatter inside the trades feature, and a second spelling of a date is how one
 * screen ends up reading `Jul 15, 2026` beside another reading `15/07/2026`.
 * `trade-card.utils.ts` re-exports both under their old names, so the card and
 * its tests keep the import they had.
 */
export function formatInstantDate(at: number | null): string {
  if (at === null) return "date unknown";
  const d = new Date(at);
  return `${MONTH_ABBREVIATIONS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * The time of day, e.g. `3:07 PM`, or the empty string where there is no instant
 * to read.
 *
 * On a trade card it holds the slot the scoring week used to. A week is a coarser
 * reading of the same instant the date beside it already gives — "Aug 1, 2026 ·
 * Wk 1" says twice when, and says it in a unit that means nothing for most of the
 * calendar, since Sleeper files an offseason trade under no week at all. The
 * clock time is what the date was missing: moves come in flurries, and which of
 * this afternoon's five landed first is a question a date cannot answer. The
 * timeline rail names its stops for exactly that reason.
 *
 * Read in the **reader's own zone**, unlike the season-shaped dates elsewhere in
 * the app: `TODAY_ET` is Eastern because it decides what the NFL has played,
 * where this is a wall-clock reading of a moment for whoever is looking at it.
 * It is still spelled out by hand rather than through `toLocaleTimeString`, so
 * the digits match the date it sits beside in every locale.
 *
 * **It used to carry its own ` · ` separator and does not now**, which is worth
 * knowing before one is added back: the two facts shared a single readout on the
 * trade card's first interior line, so the separator had to live on the *time* —
 * that being the half that vanishes for an undated trade, and a dangling "date
 * unknown ·" is the failure it prevented. They are two elements on a plate now
 * (see `TradeInstantLedge`), parted by a gap and a change of material, so a
 * punctuation mark between them would be a third thing saying what the layout
 * already does — and the empty string is what draws no element at all.
 *
 * It is a second function rather than a branch inside {@link formatInstantDate}
 * because the two answer differently to a missing instant: the date says so in
 * words, and the time simply isn't there to say it twice.
 */
export function formatInstantTime(at: number | null): string {
  if (at === null) return "";
  const d = new Date(at);
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

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
