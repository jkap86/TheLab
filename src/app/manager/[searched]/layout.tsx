import {
  AdpControlsProvider,
  LeagueFiltersProvider,
  ManagerSeasonProvider,
  SubjectFiltersProvider,
} from "@/features/manager";
import { getActiveSeason } from "@/shared/season";

/**
 * Wraps the Leagues, Players and Leaguemates tabs so what is chosen on one
 * carries to the others — which season is being read, the league-list filters,
 * the *who is in it* selection beside them, and the ADP board. Keyed by the
 * searched manager, so all four reset when you switch to a different one: the
 * `key` remounts the whole subtree, the fresh-per-manager behaviour the pages
 * already get from their own `key`.
 *
 * Four providers rather than one because they answer to different people: the
 * season decides which leagues there are at all, the league filters describe
 * what a league *is* (and are the same type the trades board runs), the subjects
 * are a lookup into this manager's rosters and membership, and the board
 * describes every crawled draft and belongs to no manager at all.
 *
 * It is also where the season stepper and the ADP board learn which season is
 * the current one. That is a server-side fact (`getActiveSeason()`, the same
 * resolver the routes default to), and a layout is a server component, so it
 * reaches the client stores as a prop rather than being re-derived from a clock
 * in pure client code — where it would be a guess about when Sleeper rolls a
 * league year over. It is awaited once and handed to both, so the ladder's
 * ceiling and the board's default cannot disagree.
 */
export default async function ManagerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ searched: string }>;
}) {
  const { searched } = await params;
  const activeSeason = await getActiveSeason();
  return (
    <LeagueFiltersProvider key={searched}>
      <ManagerSeasonProvider season={activeSeason}>
        <SubjectFiltersProvider>
          <AdpControlsProvider season={activeSeason}>
            {children}
          </AdpControlsProvider>
        </SubjectFiltersProvider>
      </ManagerSeasonProvider>
    </LeagueFiltersProvider>
  );
}
