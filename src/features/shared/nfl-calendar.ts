/**
 * The league year the crawled drafts hang off: when the NFL draft was, when
 * preseason ran, when the regular season ran.
 *
 * It exists to express the question a fixed preset never can. "Drafts since the
 * NFL draft" is the most natural cut of a rookie board there is, and no chip
 * and no typed number can carry it, because the date moves every April — the
 * window control's ◆ key computes it from this table instead (`lookback`'s
 * `draftAnchor`). The spans are why a May spike is not "a spike in May": it is
 * the fortnight after the draft, and the August one is preseason startups.
 *
 * Pure and testable like its neighbours `shares` and `league-metrics`: a table
 * and a few functions over it, no I/O. It lives here rather than in `shared/`
 * because only this feature reads it — the window's draft anchor and the
 * header's kickoff countdown; move it out the day something server-side needs
 * to label a date.
 */

/** What a marker is. The draft is an instant; the other two are spans. */
export type NflMarkerKind = "draft" | "preseason" | "regular";

export type NflMarker = {
  kind: NflMarkerKind;
  /** Inclusive `YYYY-MM-DD` bounds. `from === to` for the draft. */
  from: string;
  to: string;
  /** The full name, for a title or an accessible label. */
  label: string;
  /** The word a band wears when it is wide enough; null for the draft's flag. */
  chip: string | null;
};

/**
 * One NFL year. Three dates and two spans per season, which is the entire
 * maintenance burden of this feature — a new row a year.
 *
 * `draft` is round one, the Thursday, not the three-day span: it is the instant
 * a rookie board is read against, and marking it as a range would invite
 * selecting *the draft weekend*, which holds almost no fantasy drafts at all.
 *
 * Dates for a season the league hasn't played yet are provisional (the schedule
 * is announced in the spring), which is why the marker labels name the season —
 * a reader who knows 2026 kicked off on a different Thursday can see which claim
 * is being made.
 */
type NflSeason = {
  season: number;
  /** Round one. */
  draft: string;
  preseason: [from: string, to: string];
  regular: [from: string, to: string];
};

const NFL_SEASONS: readonly NflSeason[] = [
  {
    season: 2023,
    draft: "2023-04-27",
    preseason: ["2023-08-03", "2023-08-26"],
    regular: ["2023-09-07", "2024-01-07"],
  },
  {
    season: 2024,
    draft: "2024-04-25",
    preseason: ["2024-08-01", "2024-08-25"],
    regular: ["2024-09-05", "2025-01-05"],
  },
  {
    season: 2025,
    draft: "2025-04-24",
    preseason: ["2025-07-31", "2025-08-23"],
    regular: ["2025-09-04", "2026-01-04"],
  },
  {
    season: 2026,
    draft: "2026-04-23",
    preseason: ["2026-08-06", "2026-08-29"],
    regular: ["2026-09-10", "2027-01-03"],
  },
];

/** The newest season written down rather than derived. */
const LAST_TABLED_SEASON = NFL_SEASONS[NFL_SEASONS.length - 1].season;

/**
 * A season past the table, derived from the NFL's own scheduling habits.
 *
 * The table used to stop at 2026, which meant the ADP strip's markers and the
 * kickoff countdown simply vanished the following spring — a feature that
 * expires on a date nobody is watching. Three rules cover every season in the
 * table above, so a season past it gets bands rather than nothing:
 *
 *   - **The regular season opens on the Thursday after Labor Day** (the first
 *     Monday of September). Exact for 2023–2026.
 *   - **Preseason runs from 35 days before that opener to 12 days before it.**
 *     Within a day of every tabled season.
 *   - **Round one of the draft is the Thursday falling in April 23–29.** There
 *     is exactly one such Thursday a year, and it is the right one for all four
 *     tabled seasons — the plain "last Thursday of April" rule is not (2026's
 *     draft is the 23rd, and April 30 that year is a Thursday).
 *
 * These are habits, not commitments, which is why a derived row is labelled
 * `(projected)`: a marker claiming to know a date the league hasn't announced
 * is worse than one saying it guessed. A tabled row always wins — adding next
 * year's real dates is still one row of maintenance, and it replaces the guess.
 */
function deriveSeason(season: number): NflSeason {
  const opener = thursdayAfterLaborDay(season);
  return {
    season,
    draft: lateAprilThursday(season),
    preseason: [addDays(opener, -35), addDays(opener, -12)],
    // Eighteen weeks, ending on week 18's Sunday.
    regular: [opener, addDays(opener, 17 * 7 + 3)],
  };
}

/** `YYYY-MM-DD` for a UTC date, which is the only zone this table speaks. */
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

/** The Thursday after September's first Monday — the traditional opener. */
function thursdayAfterLaborDay(season: number): string {
  const first = new Date(Date.UTC(season, 8, 1));
  // 1 = Monday. Days forward to the first Monday of the month.
  const laborDay = 1 + ((8 - first.getUTCDay()) % 7);
  return iso(new Date(Date.UTC(season, 8, laborDay + 3)));
}

/** The one Thursday falling between April 23 and April 29 inclusive. */
function lateAprilThursday(season: number): string {
  for (let day = 23; day <= 29; day++) {
    const date = new Date(Date.UTC(season, 3, day));
    if (date.getUTCDay() === 4) return iso(date);
  }
  // Unreachable: any seven consecutive days contain exactly one Thursday.
  return iso(new Date(Date.UTC(season, 3, 25)));
}

/**
 * The row for a season: the tabled one if there is one, otherwise a derived
 * (projected) one. Never null — a season is always describable, and whether the
 * description is authoritative is what `provisional` says.
 */
function seasonRow(season: number): { row: NflSeason; provisional: boolean } {
  const tabled = NFL_SEASONS.find((s) => s.season === season);
  return tabled
    ? { row: tabled, provisional: false }
    : { row: deriveSeason(season), provisional: true };
}

/**
 * The *provisional* instant a season's first regular-season game kicks off, in
 * epoch ms — null only for a season outside the plausible range, never a guess
 * this module can't justify.
 *
 * Provisional because the authority is Sleeper's schedule call (`/api/kickoff`
 * reads it, `useKickoff` asks): this is the countdown's fallback for a season
 * Sleeper hasn't scheduled yet, which is exactly the spring window this
 * table's own dates are provisional in. The date is the regular season's own
 * start; the hour is the traditional Thursday-opener slot, 8:20 PM Eastern,
 * because the table carries dates and not hours. The offset is a constant
 * `-04:00` since every opener is played in September, which is always Eastern
 * *daylight* time.
 */
export function firstKickoff(season: string): number | null {
  if (!/^\d{4}$/.test(season)) return null;
  const year = Number(season);
  // Bounded rather than open-ended: a countdown to a season two decades out is
  // arithmetic, not information, and a junk season should read as "unknown".
  if (year < NFL_SEASONS[0].season || year > LAST_TABLED_SEASON + 5) return null;
  const { row } = seasonRow(year);
  return new Date(`${row.regular[0]}T20:20:00-04:00`).getTime();
}

/**
 * Every marker in date order, through `throughSeason`.
 *
 * Defaults to the last tabled season, so nothing derived appears unless a caller
 * asks for a range that reaches into one — `nflMarkersIn` does, from the range's
 * own end date. Taking the bound from the data rather than from a clock keeps
 * this deterministic: server and client render the same bands, and no marker
 * appears or vanishes as the year turns over mid-session.
 */
export function nflMarkers(throughSeason: number = LAST_TABLED_SEASON): NflMarker[] {
  const seasons: number[] = [];
  for (let year = NFL_SEASONS[0].season; year <= throughSeason; year++) {
    seasons.push(year);
  }

  const markers = seasons.flatMap((year): NflMarker[] => {
    const { row: s, provisional } = seasonRow(year);
    const suffix = provisional ? " (projected)" : "";
    return [
      {
        kind: "draft",
        from: s.draft,
        to: s.draft,
        label: `${s.season} NFL draft${suffix}`,
        chip: null,
      },
      {
        kind: "preseason",
        from: s.preseason[0],
        to: s.preseason[1],
        label: `${s.season} preseason${suffix}`,
        chip: "Pre",
      },
      {
        kind: "regular",
        from: s.regular[0],
        to: s.regular[1],
        label: `${s.season} regular season${suffix}`,
        chip: "Reg season",
      },
    ];
  });
  // String order is date order for `YYYY-MM-DD`.
  return markers.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * The markers overlapping `[from, to]`, clipped to it.
 *
 * Clipping rather than dropping a partly-visible span is what keeps the strip
 * honest at its edges: a regular season that started before the first crawled
 * draft still ran through the months on screen, and drawing only the part that
 * fits says so. A marker that misses the window entirely is dropped.
 */
export function nflMarkersIn(from: string, to: string): NflMarker[] {
  if (from > to) return [];
  // The bound comes from the window being drawn, not from a clock: a range that
  // runs into a season the table doesn't hold gets that season's derived bands,
  // and one that doesn't costs nothing. Deterministic for a given range, which
  // is what keeps server and client renders identical.
  const through = Number(to.slice(0, 4));
  return nflMarkers(Number.isFinite(through) ? through : undefined)
    .filter((m) => m.to >= from && m.from <= to)
    .map((m) => ({
      ...m,
      from: m.from < from ? from : m.from,
      to: m.to > to ? to : m.to,
    }));
}
