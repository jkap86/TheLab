import { LeagueFiltersProvider } from "@/features/manager";

/**
 * Wraps the Leagues, Players and Leaguemates tabs so the league filters chosen
 * on one carry to the others. Keyed by the searched manager, so the selection
 * resets when you switch to a different one — the fresh-per-manager behaviour
 * the pages already get from their own `key`.
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
    <LeagueFiltersProvider key={searched}>{children}</LeagueFiltersProvider>
  );
}
