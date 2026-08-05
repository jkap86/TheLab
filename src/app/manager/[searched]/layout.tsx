import {
  AdpControlsProvider,
  LeagueFiltersProvider,
  SubjectFiltersProvider,
} from "@/features/manager";
import { getActiveSeason } from "@/shared/season";

/**
 * Wraps the Leagues, Players and Leaguemates tabs so the filters chosen on one
 * carry to the others — the league-list filters, the *who is in it* selection
 * beside them, and the ADP board. Keyed by the searched manager, so all three
 * reset when you switch to a different one: the `key` remounts the whole
 * subtree, the fresh-per-manager behaviour the pages already get from their own
 * `key`.
 *
 * Three providers rather than one because they answer to different people: the
 * league filters describe what a league *is* (and are the same type the trades
 * board runs), the subjects are a lookup into this manager's rosters and
 * membership, and the board describes every crawled draft and belongs to no
 * manager at all.
 *
 * It is also where the ADP board learns which season is the current one. That
 * is a server-side fact (`getActiveSeason()`, the same resolver the routes default
 * to), and a layout is a server component, so it reaches the client store as a
 * prop rather than being re-derived from a clock in pure client code — where it
 * would be a guess about when Sleeper rolls a league year over.
 */
export default async function ManagerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ searched: string }>;
}) {
  const { searched } = await params;
  return (
    <LeagueFiltersProvider key={searched}>
      <SubjectFiltersProvider>
        <AdpControlsProvider season={await getActiveSeason()}>
          {children}
        </AdpControlsProvider>
      </SubjectFiltersProvider>
    </LeagueFiltersProvider>
  );
}
