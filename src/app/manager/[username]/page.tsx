import { ConsoleGround, PageShell } from "@/features/shared";
import { LeaguesHome } from "@/features/manager";

export default async function ManagerPage({
  params,
  searchParams,
}: PageProps<"/manager/[username]">) {
  const { username } = await params;
  const { season } = await searchParams;

  return (
    <>
      {/* The page's surface runs to the viewport edges rather than being a
          panel drawn inside the shell — see `ConsoleGround`. It is rendered
          per route rather than in `layout.tsx` because the pages that still
          draw their own panel would get a panel on a panel. */}
      <ConsoleGround />
      {/* `console` rather than `wide`: every card carries four lit readouts,
          which clip to "1st o…" at the narrower shell. */}
      <PageShell width="console">
        {/* The heading is passed in rather than owned by `LeaguesHome`, which is a
            client component: this keeps the page's one piece of static copy on
            the server side of the boundary.

            In the console layout the copy is the plate's eyebrow rather than the
            plate's headline — the headline is the manager's display name, which
            only exists once the stream has answered. `ManagerPlate` renders this
            node above the engraved name, so the seam is unchanged. */}
        <LeaguesHome
          username={username}
          // Passed through as given; the route is what validates a season, so a
          // bad one comes back as a 400 the hook shows rather than being silently
          // dropped here. A repeated `?season=` is nobody's intent, so the array
          // case is treated as absent.
          season={typeof season === "string" ? season : undefined}
          heading={
            // A `span`, not a heading: the page's one `<h1>` is the engraved
            // name inside the plate, and this sits above it as an eyebrow.
            <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/60 sm:text-[length:var(--fs-11)]">
              Manager
            </span>
          }
        />
      </PageShell>
    </>
  );
}
