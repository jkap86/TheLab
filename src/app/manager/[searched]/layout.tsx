import { AdpControlsProvider, LeagueFiltersProvider } from "@/features/manager";

/**
 * Wraps the Leagues, Players and Leaguemates tabs so the filters chosen on one
 * carry to the others — both the league-list filters and the ADP bar. Keyed by
 * the searched manager, so both selections reset when you switch to a different
 * one: the `key` remounts the whole subtree, the fresh-per-manager behaviour the
 * pages already get from their own `key`.
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
      <AdpControlsProvider>{children}</AdpControlsProvider>
    </LeagueFiltersProvider>
  );
}
