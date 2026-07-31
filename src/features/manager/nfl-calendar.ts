/**
 * The league year the crawled drafts hang off: when the NFL draft was, when
 * preseason ran, when the regular season ran.
 *
 * It exists so the ADP board's date range is chosen against something that means
 * something. A spike of drafts in May is not "a spike in May" — it is *the
 * fortnight after the NFL draft*, which is why rookie boards move then; the
 * August one is preseason startups. Without the calendar underneath, picking a
 * window is picking dates blind and reading the count afterward.
 *
 * It is also the only way to express the question a preset never can. "Drafts
 * since the NFL draft" is the most natural cut of a rookie board there is, and
 * no fixed chip can carry it, because the date moves every April — a marker can.
 *
 * Pure and testable like its neighbours `shares` and `league-metrics`: a table
 * and two functions over it, no I/O. It lives here rather than in `shared/`
 * because only the drawer reads it; move it out the day something server-side
 * needs to label a date.
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

/** Every marker the table holds, in date order. */
export function nflMarkers(): NflMarker[] {
  const markers = NFL_SEASONS.flatMap((s): NflMarker[] => [
    {
      kind: "draft",
      from: s.draft,
      to: s.draft,
      label: `${s.season} NFL draft`,
      chip: null,
    },
    {
      kind: "preseason",
      from: s.preseason[0],
      to: s.preseason[1],
      label: `${s.season} preseason`,
      chip: "Pre",
    },
    {
      kind: "regular",
      from: s.regular[0],
      to: s.regular[1],
      label: `${s.season} regular season`,
      chip: "Reg season",
    },
  ]);
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
  return nflMarkers()
    .filter((m) => m.to >= from && m.from <= to)
    .map((m) => ({
      ...m,
      from: m.from < from ? from : m.from,
      to: m.to > to ? to : m.to,
    }));
}
