import { PageShell } from "@/features/shared";
import { PicktrackerBoard } from "@/features/picktracker";

export default async function PicktrackerLeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  // Key by league so navigating to a different one remounts with fresh state.
  return (
    <PageShell>
      <PicktrackerBoard key={leagueId} leagueId={leagueId} />
    </PageShell>
  );
}
