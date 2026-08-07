import { ManagerPlayers } from "@/features/manager/components/manager-players";

export default async function ManagerPlayersPage({
  params,
}: {
  params: Promise<{ searched: string }>;
}) {
  const { searched } = await params;
  // Key by manager so navigating to a different one remounts with fresh state.
  return <ManagerPlayers key={searched} searched={searched} />;
}
