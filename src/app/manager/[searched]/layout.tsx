import { AdpControlsProvider, LeagueFiltersProvider } from "@/features/manager";
import { DEFAULT_SEASON } from "@/shared/sleeper";

/**
 * Wraps the Leagues, Players and Leaguemates tabs so the filters chosen on one
 * carry to the others — both the league-list filters and the ADP bar. Keyed by
 * the searched manager, so both selections reset when you switch to a different
 * one: the `key` remounts the whole subtree, the fresh-per-manager behaviour the
 * pages already get from their own `key`.
 *
 * It is also where the ADP board learns which season is the current one. That
 * is a server-side fact (`DEFAULT_SEASON`, the same constant the routes default
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
      <AdpControlsProvider season={DEFAULT_SEASON}>{children}</AdpControlsProvider>
    </LeagueFiltersProvider>
  );
}
