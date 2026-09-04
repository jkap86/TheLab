import { ConsoleGround, PageShell } from "@/features/shared";
import { PicktrackerHome } from "@/features/picktracker";

export default function PicktrackerPage() {
  return (
    <>
      <ConsoleGround />
      <PageShell width="console">
        <PicktrackerHome
          heading={
            <h1 className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
              Pick Tracker
            </h1>
          }
        />
      </PageShell>
    </>
  );
}
