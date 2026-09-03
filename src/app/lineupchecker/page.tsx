import { PageShell } from "@/features/shared";
import { LineupCheckerHome } from "@/features/lineupchecker";

export default function LineupCheckerPage() {
  return (
    // `console` rather than `wide`, the leagues console's measured reason: the
    // cards carry lit readouts, and at the narrower shell a tile clips to the
    // very figure it exists to show.
    <PageShell width="console">
      {/* The heading is passed in rather than owned by `LineupCheckerHome`,
          which is a client component: this keeps the page's one piece of static
          copy on the server side of the boundary. It is the plate's eyebrow,
          not its headline — the headline is the manager's display name, which
          only exists once the stream has answered. */}
      <LineupCheckerHome
        heading={
          // A `span`, not a heading: the page's one `<h1>` is the engraved name
          // inside the plate, and this sits above it as an eyebrow.
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
            Lineup Checker
          </span>
        }
      />
    </PageShell>
  );
}
