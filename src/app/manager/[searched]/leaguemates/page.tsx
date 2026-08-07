import { ManagerLeaguemates } from "@/features/manager/components/manager-leaguemates";

export default async function ManagerLeaguematesPage({
  params,
}: {
  params: Promise<{ searched: string }>;
}) {
  const { searched } = await params;
  // Key by manager so navigating to a different one remounts with fresh state.
  return <ManagerLeaguemates key={searched} searched={searched} />;
}
