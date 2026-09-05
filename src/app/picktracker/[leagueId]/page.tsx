import { ConsoleGround, PageShell } from "@/features/shared";
import { PicktrackerBoard } from "@/features/picktracker";

export const dynamic = "force-dynamic";

export default async function PicktrackerLeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  return (
    <>
      <ConsoleGround />
      <PageShell width="console">
        <h1 className="mb-6 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
          Pick Tracker
        </h1>
        {/* **The key is load-bearing.** Navigating league to league remounts
            with a blank slate rather than transitioning one league's board
            into another's — the rule `LineupCheckerHome` applies to a changed
            account, one grain down. */}
        <PicktrackerBoard key={leagueId} leagueId={leagueId} />
      </PageShell>
    </>
  );
}
