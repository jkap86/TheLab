import type { ManagerLeague } from "@/shared/manager";

import type { LeagueFilters } from "./league-filters/index";
import type { Subject, SubjectFilters, SubjectLabel } from "./subjects.ts";

/**
 * What the subject rail and the two shares sheets need of the page they narrow.
 *
 * **It exists because those parts have two callers with different state behind
 * them, and only this much of it is shared.** The manager tabs build theirs in
 * `useFilteredLeagues` — a cached NDJSON stream keyed on a searched name, filters
 * held in a provider because three *routes* share one selection. The lineup
 * checker builds its own from the stored account and plain `useState`, since it
 * is one page. Neither of those is a fact the rail has any business knowing, so
 * what crosses is this: the two league lists, the two selections, and how to name
 * a chosen subject.
 *
 * The two league lists are both here on purpose, and mixing them up is the one
 * mistake this type is shaped to prevent. {@link leagueFiltered} is *after* the
 * league filters and *before* the subjects, and it is what the menus count over —
 * a menu counted over its own selection collapses to that selection the moment
 * anything is picked and cannot be widened again without being cleared, the rule
 * the trades board's facets keep for the same reason. {@link filtered} is what
 * survives both, which is what the rail's own readout states.
 *
 * The subject selection travels as a value rather than being read from a context
 * inside the rail, which is what lets the lineup checker hold it in local state.
 * A provider is what three routes sharing one selection need; a page that is one
 * route needs a `useState`, and a shared part that insisted on the provider would
 * be making that choice for both of them.
 */
export type SubjectView = {
  /**
   * How this manager is spelled in the cache — see `managerQueryKeys`, whose
   * first act is to lower-case it.
   *
   * A username, on both callers: the manager tabs take the one in the URL and
   * the lineup checker takes the one on the stored account, so a reader crossing
   * between the two tools reads one set of entries rather than two.
   */
  searched: string;
  /**
   * Which season's rosters and membership the rail's own reads should ask for,
   * or `undefined` for the app's current one.
   *
   * **Undefined is the shared spelling and not merely a default.** The routes
   * fill an absent `?season` with `getActiveSeason()` and `managerQueryKeys`
   * files it under `"default"`, so a caller that named the current season would
   * open a second entry holding the identical answer — see {@link seasonParam}.
   * The lineup checker passes nothing at all (it reads the season it is in), and
   * the manager tabs pass a *past* season only when their header's stepper has
   * been walked back to one.
   *
   * **`seasonRead` rather than `season`, because a page already has one of
   * those and it is not this.** The lineup checker carries the season its
   * *payload* came back with, for display; this is the season its *requests* ask
   * for, and the two differ in both type and meaning — the display one is null
   * until a result lands, this one is undefined for the commonest case. Sharing
   * a name would have made the collision a matter of which file you were reading.
   */
  seasonRead?: string;
  /**
   * The manager's canonical Sleeper id, or null before it has been resolved.
   *
   * Sent with every sub-resource read so the route needn't ask Sleeper who the
   * searched name is a second time, and used as the id the leaguemate options
   * drop — they are in every league on the list, so an option matching all of
   * them narrows nothing.
   */
  userId: string | null;
  /** Every league on the account, or null before the list has arrived. */
  leagues: ManagerLeague[] | null;
  /** After the league filters, before the subjects — what the menus count over. */
  leagueFiltered: ManagerLeague[];
  /** What survives both narrowings — the list on screen. */
  filtered: ManagerLeague[];
  filters: LeagueFilters;
  setFilters: (filters: LeagueFilters) => void;
  subjects: SubjectFilters;
  setSubjects: (subjects: SubjectFilters) => void;
  /**
   * How a selected subject is drawn, or null while the maps naming it load.
   *
   * It answers for *both* kinds, which is why a token reads it rather than the
   * menu beside it: a sheet only builds the option list for the kind it lists, so
   * naming a token from that list left a player token in the leaguemates sheet
   * showing a raw Sleeper id.
   */
  subjectDisplay: (subject: Subject) => SubjectLabel | null;
  /** True while a selected subject's maps are still being read. */
  subjectsLoading: boolean;
};
