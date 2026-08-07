import { ManagerLeagues } from "@/features/manager/components/manager-leagues";

export default async function ManagerLeaguesPage({
  params,
}: {
  params: Promise<{ searched: string }>;
}) {
  const { searched } = await params;
  // Key by manager so navigating to a different one remounts with fresh state.
  return <ManagerLeagues key={searched} searched={searched} />;
}
